/* global f3 */
'use strict';

const API_BASE = window.FAMILY_TREE_CONFIG.apiBase.replace(/\/+$/, '');
const TOKEN_KEY = 'familyTree.token';
const SYNC_CHUNK = 40; // must not exceed MAX_CHANGES_PER_REQUEST in worker/index.js

// Fields in the person panel. `id` is the key stored in the database.
const FIELDS = [
  { id: 'first name', label: 'First name', type: 'text' },
  { id: 'last name', label: 'Last name', type: 'text' },
  { id: 'maiden name', label: 'Maiden name', type: 'text' },
  { id: 'birthday', label: 'Born', type: 'date' },
  { id: 'birthplace', label: 'Place of birth', type: 'text' },
  { id: 'deathday', label: 'Died', type: 'date' },
  { id: 'occupation', label: 'Occupation', type: 'text' },
  { id: 'phone', label: 'Phone', type: 'tel' },
  { id: 'email', label: 'Email', type: 'email' },
  { id: 'address', label: 'Address', type: 'text' },
  { id: 'notes', label: 'Notes', type: 'textarea' },
  { id: 'avatar', label: 'Photo', type: 'photo' },
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

setupTheme();
setupLogin();
setupSearch();
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
  if (API_BASE.includes('YOUR-SUBDOMAIN')) message = 'The API address is not set yet. Update web/config.js.';
  showLoginError(message);
  $('#password').focus();
}

function showLoginError(message) {
  const box = $('#login-error');
  box.textContent = message;
  box.hidden = !message;
}

function lock() {
  if (hasUnsavedChanges() && !confirm('Some changes are not saved yet. Lock anyway?')) return;
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
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    setToken(null);
    showLogin('Your session expired. Please enter the password again.');
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
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

  showChartMessage('Loading family tree…');
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
    .setSingleParentEmptyCard(true, { label: 'Unknown' });

  // family-chart inserts card text as HTML, so everything we hand it is escaped.
  const card = chart
    .setCardHtml()
    .setStyle('imageRect')
    .setCardImageField('avatar')
    .setCardDisplay([(d) => escapeHtml(fullName(d) || 'Unnamed'), (d) => escapeHtml(lifespan(d))])
    .setMiniTree(true)
    .setOnHoverPathToMain();

  editTree = chart
    .editTree()
    .fixed()
    .setFields(FIELDS)
    .setEditFirst(isEmpty)
    .setCardClickOpen(card)
    .setLinkExistingRelConfig({
      linkRelLabel: (d) => fullName(d) || 'Unnamed',
      title: 'Or link someone already in the tree',
      select_placeholder: 'Choose a person',
    })
    .setCreateFormEdit(createPersonPanel)
    .setCreateFormNew(createPersonPanel)
    .setOnChange(scheduleSync);

  chart.updateTree({ initial: true });
  if (isEmpty) editTree.open(chart.getMainDatum());
  editTree.setEditFirst(false);
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
  const box = $('#save-status');
  box.dataset.state = state;
  box.title = message;
  if (state === 'saving') box.replaceChildren('Saving…');
  else if (state === 'saved') box.replaceChildren('Saved');
  else if (state === 'error') box.replaceChildren('Not saved · ', button('Retry', 'link-btn', scheduleSync));
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
    const name = personName() || 'Unnamed';
    const avatar = value('avatar');
    const gender = fc.gender_field.initial_value;
    const years = lifespan({ data: { birthday: value('birthday'), deathday: value('deathday') } });
    const facts = fc.fields.filter((f) => !PROFILE_FIELDS.has(f.id) && f.initial_value);

    let hint = null;
    if (fc.addRelativeActive) hint = 'Click one of the dashed “Add …” cards in the tree to add that relative.';
    if (fc.removeRelativeActive) hint = 'Click the relative you want to disconnect from this person.';

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
        gender ? el('dt', {}, 'Gender') : null,
        gender ? el('dd', {}, gender === 'F' ? 'Female' : 'Male') : null,
        ...facts.flatMap((f) => [el('dt', {}, f.label), el('dd', {}, factValue(f))]),
      ),
      facts.length ? null : el('p', { class: 'muted' }, 'No details yet. Click “Edit details” to add some.'),
      hint ? el('p', { class: 'hint' }, hint) : null,
      el(
        'div',
        { class: 'panel-actions' },
        fc.no_edit ? null : button('Edit details', 'btn btn-primary', () => {
          fc.editable = true;
          render();
        }),
        fc.no_edit ? null : button(fc.addRelativeActive ? 'Cancel adding' : 'Add relative', 'btn', toggleAddRelative),
        fc.no_edit ? null : button(fc.removeRelativeActive ? 'Cancel removing' : 'Remove relation', 'btn', toggleRemoveRelative),
        fc.no_edit ? null : button('Delete person', 'btn btn-danger', deletePerson, !fc.can_delete),
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
    const title = isNew ? fc.title : name ? `Edit ${name}` : 'New person';
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
        button('Cancel', 'btn', cancel),
        el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'),
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
      el('legend', {}, 'Gender'),
      ...g.options.map((o) =>
        el(
          'label',
          { class: 'radio' },
          el('input', { type: 'radio', name: 'gender', value: o.value, checked: o.value === g.initial_value, disabled: g.disabled }),
          o.label,
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
            placeholder: f.type === 'date' ? 'YYYY-MM-DD or just YYYY' : null,
            autocomplete: 'off',
          });
    control.value = f.initial_value || '';
    return el('div', { class: 'field' }, el('label', { for: id }, f.label), control);
  }

  function photoInput(f) {
    const stored = el('input', { type: 'hidden', name: f.id });
    stored.value = f.initial_value || '';
    const preview = el('img', { class: 'photo-preview', alt: '' });
    const fileInput = el('input', { type: 'file', id: 'photo-file', accept: 'image/*', class: 'visually-hidden' });
    const pick = el('label', { for: 'photo-file', class: 'btn' });
    const remove = button('Remove', 'btn btn-quiet', () => {
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
        error.textContent = 'That image could not be read. Try a JPEG or PNG.';
        error.hidden = false;
      }
      refresh();
    });

    function refresh() {
      preview.hidden = !stored.value;
      if (stored.value) preview.src = stored.value;
      else preview.removeAttribute('src');
      pick.textContent = stored.value ? 'Change photo' : 'Upload photo';
      remove.hidden = !stored.value;
    }
    refresh();

    return el(
      'div',
      { class: 'field' },
      el('span', { class: 'label' }, f.label),
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
      el('option', { value: '' }, link.select_placeholder || 'Choose a person'),
      ...link.options.map((o) => el('option', { value: o.value }, String(o.label))),
    );
    select.addEventListener('change', link.onSelect);
    return el(
      'div',
      { class: 'field link-existing' },
      el('label', { for: 'link-existing' }, link.title || 'Or link someone already in the tree'),
      select,
    );
  }

  function panelTop() {
    return el('div', { class: 'panel-top' }, button('×', 'icon-btn close-btn', close, false, 'Close'));
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
    if (confirm(`Delete ${personName() || 'this person'} from the family tree?`)) fc.onDelete();
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
          el('span', {}, fullName(d) || 'Unnamed'),
          el('span', { class: 'years' }, lifespan(d)),
        );
        pick.addEventListener('click', () => select(d.id));
        return el('li', { role: 'option' }, pick);
      }),
    );
    if (query && !matches.length) list.append(el('li', { class: 'empty' }, 'No one found'));
    list.hidden = !query;
  }

  function select(id) {
    input.value = '';
    list.hidden = true;
    input.blur();
    if (editTree.isAddingRelative()) editTree.addRelativeInstance.onCancel();
    if (editTree.isRemovingRelative()) editTree.removeRelativeInstance.onCancel();
    chart.updateMainId(id);
    chart.updateTree({ tree_position: 'main_to_middle' });
    editTree.openFormWithId(id);
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
      btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-label', btn.title);
    }
  }

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

// ---------- helpers ----------

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
  if (born) return `b. ${born}`;
  if (died) return `d. ${died}`;
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
  box.replaceChildren(el('p', {}, text), retry ? button('Try again', 'btn', retry) : '');
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
