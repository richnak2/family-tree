/* global f3 */
'use strict';

const API_BASE = window.FAMILY_TREE_CONFIG.apiBase.replace(/\/+$/, '');
const TOKEN_KEY = 'familyTree.token';
const SYNC_CHUNK = 40; // must not exceed MAX_CHANGES_PER_REQUEST in worker/index.js

// Fields in the person panel. `id` is the key stored in the database; labels are in i18n.js ("field:<id>").
const FIELDS = [
  { id: 'first name', type: 'text' },
  { id: 'last name', type: 'text' },
  { id: 'maiden name', type: 'text' },
  { id: 'birthday', type: 'date' },
  { id: 'birthplace', type: 'text' },
  { id: 'deathday', type: 'date' },
  { id: 'occupation', type: 'text' },
  { id: 'phone', type: 'tel' },
  { id: 'email', type: 'email' },
  { id: 'address', type: 'text' },
  { id: 'notes', type: 'textarea' },
  { id: 'avatar', type: 'photo' },
];
const PROFILE_FIELDS = new Set(['first name', 'last name', 'avatar']); // shown in the header, not the facts list
const AVATAR_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

const $ = (selector) => document.querySelector(selector);

let token = loadToken();
let chart = null;
let editTree = null;
let saved = new Map(); // person id -> JSON of what the server has
let syncQueue = Promise.resolve();
let syncState = 'idle';
let syncError = '';
let paintThemeButtons = () => {};
let overview = null; // "whole tree" view, created on first open
let overviewOpen = false;

setupTheme();
setupLanguage();
setupLogin();
setupSearch();
setupFit();
$('#overview-btn').addEventListener('click', () => (overviewOpen ? setOverviewOpen(false) : openOverview()));
$('#lock-btn').addEventListener('click', lock);
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges()) e.preventDefault();
});

if (hasValidToken()) openApp();
else showLogin();

// ---------- login / session ----------

function loadToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(value) {
  token = value;
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function hasValidToken() {
  return Boolean(token) && Number(token.split('.')[0]) * 1000 > Date.now();
}

function setupLogin() {
  const form = $('#login-form');
  const input = $('#password');
  const submit = $('#login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    showLoginError('');
    try {
      const { token: newToken } = await api('/api/login', { method: 'POST', body: { password: input.value } });
      setToken(newToken);
      input.value = '';
      await openApp();
    } catch (err) {
      showLoginError(err.message);
      input.select();
    } finally {
      submit.disabled = false;
    }
  });
}

function showLogin(message = '') {
  document.body.dataset.view = 'login';
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  if (API_BASE.includes('YOUR-SUBDOMAIN')) message = t('apiNotSet');
  showLoginError(message);
  $('#password').focus();
}

function showLoginError(message) {
  const box = $('#login-error');
  box.textContent = message;
  box.hidden = !message;
}

function lock() {
  if (hasUnsavedChanges() && !confirm(t('lockUnsaved'))) return;
  syncState = 'idle';
  setToken(null);
  location.reload();
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error(t('cannotReach'));
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    setToken(null);
    showLogin(t('sessionExpired'));
  }
  if (!res.ok) {
    const message =
      res.status === 401 && path === '/api/login' ? t('wrongPassword') : data.error || t('requestFailed', res.status);
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- app ----------

async function openApp() {
  document.body.dataset.view = 'app';
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;

  if (chart) {
    scheduleSync(); // logged back in after the session expired: push anything left unsaved
    return;
  }

  showChartMessage(t('loading'));
  try {
    const { people } = await api('/api/people');
    hideChartMessage();
    buildChart(people.map(cleanPerson));
    setStatus('saved');
  } catch (err) {
    if (err.status !== 401) showChartMessage(err.message, openApp);
  }
}

function buildChart(people) {
  // Drop links to people that no longer exist; family-chart throws on dangling ids.
  const ids = new Set(people.map((p) => p.id));
  for (const p of people) {
    for (const kind of ['parents', 'spouses', 'children']) p.rels[kind] = p.rels[kind].filter((id) => ids.has(id));
  }

  const isEmpty = people.length === 0;
  const data = isEmpty ? [newPerson()] : people;
  saved = snapshot(people);

  chart = f3
    .createChart('#FamilyChart', data)
    .setTransitionTime(600)
    .setCardXSpacing(260)
    .setCardYSpacing(170)
    .setShowSiblingsOfMain(true)
    .setSingleParentEmptyCard(true, { label: t('unknown') });

  // family-chart inserts card text as HTML, so everything we hand it is escaped.
  const card = chart
    .setCardHtml()
    .setStyle('imageRect')
    .setCardImageField('avatar')
    .setCardDisplay([(d) => escapeHtml(fullName(d) || t('unnamed')), (d) => escapeHtml(lifespan(d))])
    .setMiniTree(true)
    .setOnHoverPathToMain();

  editTree = chart
    .editTree()
    .fixed()
    .setFields(FIELDS)
    .setEditFirst(isEmpty)
    .setCardClickOpen(card)
    .setCreateFormEdit(createPersonPanel)
    .setCreateFormNew(createPersonPanel)
    .setPostSubmit(refreshAddRelativeCards)
    .setOnChange(scheduleSync);

  // The only dialog family-chart shows itself (removing a partner who has children); translate it.
  const showModal = editTree.modal.activate.bind(editTree.modal);
  editTree.modal.activate = (content, options) => {
    translateModal(content);
    showModal(content, options);
  };

  applyChartLanguage();
  if (!isEmpty) chart.updateMainId(bestStartingPerson(people));
  chart.updateTree({ initial: true });
  $('#fit-btn').hidden = false;
  $('#overview-btn').hidden = false;
  if (isEmpty) editTree.open(chart.getMainDatum());
  editTree.setEditFirst(false);
}

// family-chart creates one "Add Son"/"Add Daughter"/"Add Spouse" card when add mode starts and
// doesn't replace it once used. Rebuild the cards after each new relative so several children
// can be added in a row without leaving add mode.
function refreshAddRelativeCards(submitted) {
  const adding = editTree.addRelativeInstance;
  const person = adding.datum;
  if (!adding.is_active || !person || submitted.id === person.id) return;

  const reopen = adding.cancelCallback;
  adding.cancelCallback = () => {}; // activate() cancels first; skip the redraw/re-open that does
  try {
    adding.activate(person);
  } finally {
    adding.cancelCallback = reopen;
  }
}

// family-chart only draws the focused person's ancestors, descendants (with their partners),
// partners and siblings. Start on whoever brings the most people into view.
function bestStartingPerson(people) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const reachable = (startId, kind) => {
    const found = new Set();
    const stack = [...byId.get(startId).rels[kind]];
    while (stack.length) {
      const id = stack.pop();
      if (found.has(id) || !byId.has(id)) continue;
      found.add(id);
      stack.push(...byId.get(id).rels[kind]);
    }
    return found;
  };

  let best = people[0].id;
  let bestCount = 0;
  for (const person of people) {
    if (person.unknown) continue;
    const descendants = reachable(person.id, 'children');
    const visible = new Set([person.id, ...reachable(person.id, 'parents'), ...descendants]);
    for (const id of [person.id, ...descendants]) byId.get(id).rels.spouses.forEach((s) => visible.add(s));
    for (const parentId of person.rels.parents) byId.get(parentId).rels.children.forEach((c) => visible.add(c));
    if (visible.size > bestCount) {
      best = person.id;
      bestCount = visible.size;
    }
  }
  return best;
}

// Labels family-chart draws itself: placeholder cards and the "link existing person" picker.
function applyChartLanguage() {
  chart.store.state.single_parent_empty_card_label = t('unknown');
  chart.store.state.unknown_card_label = t('unknown');
  editTree.setAddRelLabels({
    father: t('addFather'),
    mother: t('addMother'),
    spouse: t('addSpouse'),
    son: t('addSon'),
    daughter: t('addDaughter'),
  });
  editTree.setLinkExistingRelConfig({
    linkRelLabel: (d) => fullName(d) || t('unnamed'),
    title: t('linkExisting'),
    select_placeholder: t('choosePerson'),
  });
}

function translateModal(content) {
  if (!(content instanceof Element)) return;
  const toCurrent = content.querySelector('[data-option="assign-to-current"]');
  const toSpouse = content.querySelector('[data-option="assign-to-spouse"]');
  const question = content.querySelector('p');
  if (toCurrent) toCurrent.textContent = t('keepWithCurrent');
  if (toSpouse) toSpouse.textContent = t('keepWithSpouse');
  if (question && toCurrent) question.textContent = t('removeSpouseQuestion');
}

function newPerson() {
  return { id: crypto.randomUUID(), data: { gender: 'M' }, rels: { parents: [], spouses: [], children: [] } };
}

function cleanPerson(p) {
  const data = {};
  for (const [key, value] of Object.entries(p.data || {})) if (typeof value === 'string') data[key] = value;
  if (data.avatar && !AVATAR_RE.test(data.avatar)) delete data.avatar;
  const rels = p.rels || {};
  return {
    id: p.id,
    data,
    rels: { parents: [...(rels.parents || [])], spouses: [...(rels.spouses || [])], children: [...(rels.children || [])] },
    ...(p.unknown ? { unknown: true } : {}),
  };
}

// ---------- saving ----------

function normalize(d) {
  const rels = d.rels || {};
  return {
    id: d.id,
    data: d.data,
    rels: { parents: rels.parents || [], spouses: rels.spouses || [], children: rels.children || [] },
    unknown: Boolean(d.unknown),
  };
}

function snapshot(people) {
  return new Map(people.map((d) => [d.id, JSON.stringify(normalize(d))]));
}

function scheduleSync() {
  syncQueue = syncQueue.then(syncNow); // one sync at a time; each one diffs against the latest state
}

async function syncNow() {
  if (!editTree) return;
  const current = snapshot(editTree.exportData());
  const changes = [];
  for (const [id, json] of current) if (saved.get(id) !== json) changes.push({ id, json });
  for (const id of saved.keys()) if (!current.has(id)) changes.push({ id, json: null });

  if (!changes.length) return setStatus('saved');
  setStatus('saving');
  try {
    for (let i = 0; i < changes.length; i += SYNC_CHUNK) {
      const part = changes.slice(i, i + SYNC_CHUNK);
      await api('/api/people/sync', {
        method: 'POST',
        body: {
          upsert: part.filter((c) => c.json).map((c) => JSON.parse(c.json)),
          delete: part.filter((c) => !c.json).map((c) => c.id),
        },
      });
      for (const c of part) {
        if (c.json) saved.set(c.id, c.json);
        else saved.delete(c.id);
      }
    }
    setStatus('saved');
  } catch (err) {
    setStatus('error', err.message);
  }
}

function hasUnsavedChanges() {
  return syncState === 'saving' || syncState === 'error';
}

function setStatus(state, message = '') {
  syncState = state;
  syncError = message;
  const box = $('#save-status');
  box.dataset.state = state;
  box.title = message;
  if (state === 'saving') box.replaceChildren(t('saving'));
  else if (state === 'saved') box.replaceChildren(t('saved'));
  else if (state === 'error') box.replaceChildren(`${t('notSaved')} · `, button(t('retry'), 'link-btn', scheduleSync));
  else box.replaceChildren();
}

// ---------- person panel (replaces family-chart's built-in form) ----------

function createPersonPanel(fc, close) {
  const isNew = 'new_rel' in fc;
  const root = el('div', { class: 'person-panel' });
  render();
  return root;

  function render() {
    root.replaceChildren(isNew || fc.editable ? editView() : detailsView());
  }

  function value(id) {
    return fc.fields.find((f) => f.id === id)?.initial_value || '';
  }

  function personName() {
    return [value('first name'), value('last name')].filter(Boolean).join(' ');
  }

  function detailsView() {
    const name = personName() || t('unnamed');
    const avatar = value('avatar');
    const gender = fc.gender_field.initial_value;
    const years = lifespan({ data: { birthday: value('birthday'), deathday: value('deathday') } });
    const facts = fc.fields.filter((f) => !PROFILE_FIELDS.has(f.id) && f.initial_value);

    let hint = null;
    if (fc.addRelativeActive) hint = t('hintAdding');
    if (fc.removeRelativeActive) hint = t('hintRemoving');

    return el(
      'div',
      { class: 'panel' },
      panelTop(),
      el(
        'div',
        { class: 'profile' },
        avatar
          ? el('img', { class: 'profile-photo', src: avatar, alt: '' })
          : el('div', { class: `profile-photo placeholder ${genderClass(gender)}`, 'aria-hidden': 'true' }, initials(name)),
        el('h2', { class: 'profile-name' }, name),
        years ? el('p', { class: 'muted' }, years) : null,
      ),
      el(
        'dl',
        { class: 'facts' },
        gender ? el('dt', {}, t('gender')) : null,
        gender ? el('dd', {}, gender === 'F' ? t('female') : t('male')) : null,
        ...facts.flatMap((f) => [el('dt', {}, fieldLabel(f)), el('dd', {}, factValue(f))]),
      ),
      facts.length ? null : el('p', { class: 'muted' }, t('noDetails')),
      hint ? el('p', { class: 'hint' }, hint) : null,
      el(
        'div',
        { class: 'panel-actions' },
        fc.no_edit ? null : button(t('editDetails'), 'btn btn-primary', () => {
          fc.editable = true;
          render();
        }),
        fc.no_edit ? null : button(fc.addRelativeActive ? t('cancelAdding') : t('addRelative'), 'btn', toggleAddRelative),
        fc.no_edit ? null : button(fc.removeRelativeActive ? t('cancelRemoving') : t('removeRelation'), 'btn', toggleRemoveRelative),
        fc.no_edit ? null : button(t('deletePerson'), 'btn btn-danger', deletePerson, !fc.can_delete),
      ),
      linkExisting(),
    );
  }

  function factValue(f) {
    const v = f.initial_value;
    if (f.type === 'email') return el('a', { href: `mailto:${v}` }, v);
    if (f.type === 'tel') return el('a', { href: `tel:${v.replace(/[^\d+]/g, '')}` }, v);
    return v;
  }

  function editView() {
    const name = personName();
    const title = isNew ? fc.title : name ? t('editTitle', name) : t('newPerson');
    const form = el(
      'form',
      { class: 'panel person-form' },
      panelTop(),
      el('h2', { class: 'panel-title' }, title),
      genderInput(),
      ...fc.fields.map(fieldInput),
      el(
        'div',
        { class: 'form-buttons' },
        button(t('cancel'), 'btn', cancel),
        el('button', { type: 'submit', class: 'btn btn-primary' }, t('save')),
      ),
      linkExisting(),
    );
    form.addEventListener('submit', (e) => {
      for (const input of form.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=file]), textarea')) {
        input.value = input.value.trim();
      }
      fc.onSubmit(e); // family-chart reads the form with FormData and updates the tree
    });
    return form;
  }

  function genderInput() {
    const g = fc.gender_field;
    return el(
      'fieldset',
      { class: 'gender' },
      el('legend', {}, t('gender')),
      ...g.options.map((o) =>
        el(
          'label',
          { class: 'radio' },
          el('input', { type: 'radio', name: 'gender', value: o.value, checked: o.value === g.initial_value, disabled: g.disabled }),
          o.value === 'F' ? t('female') : t('male'),
        ),
      ),
    );
  }

  function fieldInput(f) {
    if (f.type === 'photo') return photoInput(f);
    const id = `field-${f.id.replace(/\W+/g, '-')}`;
    const control =
      f.type === 'textarea'
        ? el('textarea', { id, name: f.id, rows: 4 })
        : el('input', {
            id,
            name: f.id,
            type: f.type === 'date' ? 'text' : f.type,
            placeholder: f.type === 'date' ? t('datePlaceholder') : null,
            autocomplete: 'off',
          });
    control.value = f.initial_value || '';
    return el('div', { class: 'field' }, el('label', { for: id }, fieldLabel(f)), control);
  }

  function photoInput(f) {
    const stored = el('input', { type: 'hidden', name: f.id });
    stored.value = f.initial_value || '';
    const preview = el('img', { class: 'photo-preview', alt: '' });
    const fileInput = el('input', { type: 'file', id: 'photo-file', accept: 'image/*', class: 'visually-hidden' });
    const pick = el('label', { for: 'photo-file', class: 'btn' });
    const remove = button(t('removePhoto'), 'btn btn-quiet', () => {
      stored.value = '';
      refresh();
    });
    const error = el('p', { class: 'form-error', hidden: true });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      error.hidden = true;
      try {
        stored.value = await resizePhoto(file);
      } catch {
        error.textContent = t('photoError');
        error.hidden = false;
      }
      refresh();
    });

    function refresh() {
      preview.hidden = !stored.value;
      if (stored.value) preview.src = stored.value;
      else preview.removeAttribute('src');
      pick.textContent = stored.value ? t('changePhoto') : t('uploadPhoto');
      remove.hidden = !stored.value;
    }
    refresh();

    return el(
      'div',
      { class: 'field' },
      el('span', { class: 'label' }, fieldLabel(f)),
      el('div', { class: 'photo-row' }, preview, pick, remove),
      fileInput,
      stored,
      error,
    );
  }

  function linkExisting() {
    const link = fc.linkExistingRelative;
    if (!link || !link.options.length) return null;
    const select = el(
      'select',
      { id: 'link-existing' },
      el('option', { value: '' }, link.select_placeholder || t('choosePerson')),
      ...link.options.map((o) => el('option', { value: o.value }, String(o.label))),
    );
    select.addEventListener('change', link.onSelect);
    return el(
      'div',
      { class: 'field link-existing' },
      el('label', { for: 'link-existing' }, link.title || t('linkExisting')),
      select,
    );
  }

  function panelTop() {
    return el('div', { class: 'panel-top' }, button('×', 'icon-btn close-btn', close, false, t('close')));
  }

  function cancel() {
    if (isNew) return fc.onCancel(); // family-chart reopens the person we were adding to
    fc.editable = false;
    fc.onCancel();
    render();
  }

  function toggleAddRelative() {
    if (fc.addRelativeActive) fc.addRelativeCancel();
    else fc.addRelative();
    fc.addRelativeActive = !fc.addRelativeActive;
    render();
  }

  function toggleRemoveRelative() {
    if (fc.removeRelativeActive) fc.removeRelativeCancel();
    else fc.removeRelative();
    fc.removeRelativeActive = !fc.removeRelativeActive;
    render();
  }

  function deletePerson() {
    if (confirm(t('confirmDelete', personName()))) fc.onDelete();
  }
}

async function resizePhoto(file, maxSize = 320) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ---------- fit to screen ----------

// family-chart fits the tree to the screen only on the first draw, and if the chart area has no size
// at that moment (window hidden, still laying out) every card lands off-screen. Refit once it has a
// size, and let people refit by hand after zooming or dragging the tree away.
function setupFit() {
  const area = $('#FamilyChart');
  $('#fit-btn').addEventListener('click', () => {
    if (overviewOpen) overview.fit();
    else chart?.updateTree({ tree_position: 'fit' });
  });

  let hadSize = false;
  new ResizeObserver(() => {
    const hasSize = area.clientWidth > 0 && area.clientHeight > 0;
    if (chart && hasSize && !hadSize) chart.updateTree({ tree_position: 'fit', transition_time: 0 });
    hadSize = hasSize;
  }).observe(area);
}

// ---------- whole tree view ----------

function openOverview() {
  if (!chart) return;
  cancelRelativeModes();
  overview ??= createOverview($('#overview'), { onSelect: focusPerson });
  setOverviewOpen(true);
  renderOverview();
  overview.fit();
}

function renderOverview() {
  overview.render(editTree.exportData().map(normalize), chart.getMainDatum()?.id);
}

function setOverviewOpen(open) {
  overviewOpen = open;
  $('#overview').hidden = !open;
  $('#FamilyChart').hidden = open;
  $('#overview-btn').setAttribute('aria-pressed', String(open));
}

// Show one person in the main chart and open their panel (from search or the whole tree view).
function focusPerson(id) {
  if (overviewOpen) setOverviewOpen(false);
  cancelRelativeModes();
  chart.updateMainId(id);
  chart.updateTree({ tree_position: 'main_to_middle' });
  editTree.openFormWithId(id);
}

function cancelRelativeModes() {
  if (editTree.isAddingRelative()) editTree.addRelativeInstance.onCancel();
  if (editTree.isRemovingRelative()) editTree.removeRelativeInstance.onCancel();
}

// ---------- search ----------

function setupSearch() {
  const input = $('#search');
  const list = $('#search-results');
  let matches = [];

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => (list.hidden = true));
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus so clicks register
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && matches[0]) {
      e.preventDefault();
      select(matches[0].id);
    } else if (e.key === 'Escape') {
      input.value = '';
      render();
    }
  });

  function render() {
    const query = input.value.trim().toLowerCase();
    matches =
      query && chart
        ? chart.store
            .getData()
            .filter((d) => !d._new_rel_data && !d.to_add && !d.unknown && searchText(d).includes(query))
            .slice(0, 8)
        : [];

    list.replaceChildren(
      ...matches.map((d) => {
        const pick = el(
          'button',
          { type: 'button' },
          el('span', {}, fullName(d) || t('unnamed')),
          el('span', { class: 'years' }, lifespan(d)),
        );
        pick.addEventListener('click', () => select(d.id));
        return el('li', { role: 'option' }, pick);
      }),
    );
    if (query && !matches.length) list.append(el('li', { class: 'empty' }, t('noOneFound')));
    list.hidden = !query;
  }

  function select(id) {
    input.value = '';
    list.hidden = true;
    input.blur();
    focusPerson(id);
  }
}

function searchText(d) {
  return [d.data['first name'], d.data['last name'], d.data['maiden name']].filter(Boolean).join(' ').toLowerCase();
}

// ---------- theme ----------

function setupTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const current = () => document.documentElement.dataset.theme || (media.matches ? 'dark' : 'light');
  const buttons = document.querySelectorAll('.theme-toggle');

  function paint() {
    const dark = current() === 'dark';
    for (const btn of buttons) {
      btn.innerHTML = dark ? SUN_ICON : MOON_ICON;
      btn.title = dark ? t('toLight') : t('toDark');
      btn.setAttribute('aria-label', btn.title);
    }
  }
  paintThemeButtons = paint;

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch {}
      paint();
    });
  }
  media.addEventListener('change', paint);
  paint();
}

// ---------- language ----------

function setupLanguage() {
  for (const btn of document.querySelectorAll('.lang-switch button')) {
    btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
  }
  applyLanguage();
}

function setLanguage(next) {
  if (next === lang || !LANGUAGES.includes(next)) return;
  lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {}
  applyLanguage();
  if (chart) refreshChartLanguage();
  if (overviewOpen) renderOverview();
}

function applyLanguage() {
  translatePage();
  for (const btn of document.querySelectorAll('.lang-switch button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
  }
  paintThemeButtons();
  setStatus(syncState, syncError);
}

function refreshChartLanguage() {
  applyChartLanguage();
  // Cancelling redraws the tree and reopens the panel, now in the new language.
  if (editTree.isAddingRelative()) return editTree.addRelativeInstance.onCancel();
  if (editTree.isRemovingRelative()) return editTree.removeRelativeInstance.onCancel();

  chart.updateTree({ tree_position: 'inherit' });
  const panel = editTree.formCont.el;
  const editing = panel?.querySelector('form'); // don't throw away what someone is typing
  if (panel?.classList.contains('opened') && !editing) editTree.openFormWithId(chart.getMainDatum().id);
}

// ---------- helpers ----------

function fieldLabel(field) {
  return t(`field:${field.id}`);
}

function fullName(d) {
  return [d.data['first name'], d.data['last name']].filter(Boolean).join(' ');
}

function year(value) {
  return /\b(\d{4})\b/.exec(value || '')?.[1] || '';
}

function lifespan(d) {
  const born = year(d.data.birthday);
  const died = year(d.data.deathday);
  if (born && died) return `${born} – ${died}`;
  if (born) return t('bornShort', born);
  if (died) return t('diedShort', died);
  return '';
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function genderClass(gender) {
  return gender === 'M' ? 'male' : gender === 'F' ? 'female' : '';
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function showChartMessage(text, retry) {
  const box = $('#chart-message');
  box.replaceChildren(el('p', {}, text), retry ? button(t('tryAgain'), 'btn', retry) : '');
  box.hidden = false;
}

function hideChartMessage() {
  $('#chart-message').hidden = true;
}

// Builds DOM nodes; strings become text nodes, so user data is never parsed as HTML.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function button(text, className, onClick, disabled = false, label = null) {
  const b = el('button', { type: 'button', class: className, disabled, 'aria-label': label }, text);
  b.addEventListener('click', onClick);
  return b;
}
