// UI text in English and Slovak. Values can be functions for text with placeholders.
const STRINGS = {
  en: {
    appTitle: 'Family Tree',
    loginPrompt: 'Enter the family password to continue.',
    password: 'Password',
    unlock: 'Unlock',
    wrongPassword: 'Wrong password',
    sessionExpired: 'Your session expired. Please enter the password again.',
    apiNotSet: 'The API address is not set yet. Update web/config.js.',
    cannotReach: 'Cannot reach the server. Check your connection and try again.',
    requestFailed: (status) => `Request failed (${status})`,

    searchPlaceholder: 'Find a person…',
    searchLabel: 'Find a person',
    noOneFound: 'No one found',
    lock: 'Lock',
    lockUnsaved: 'Some changes are not saved yet. Lock anyway?',
    toDark: 'Switch to dark mode',
    toLight: 'Switch to light mode',
    language: 'Language',
    fitTree: 'Fit the tree to the screen',

    loading: 'Loading family tree…',
    tryAgain: 'Try again',
    saving: 'Saving…',
    saved: 'Saved',
    notSaved: 'Not saved',
    retry: 'Retry',

    'field:first name': 'First name',
    'field:last name': 'Last name',
    'field:maiden name': 'Maiden name',
    'field:birthday': 'Born',
    'field:birthplace': 'Place of birth',
    'field:deathday': 'Died',
    'field:occupation': 'Occupation',
    'field:phone': 'Phone',
    'field:email': 'Email',
    'field:address': 'Address',
    'field:notes': 'Notes',
    'field:avatar': 'Photo',
    datePlaceholder: 'e.g. 1950-03-14 or just 1950',
    gender: 'Gender',
    male: 'Male',
    female: 'Female',
    bornShort: (year) => `b. ${year}`,
    diedShort: (year) => `d. ${year}`,

    unnamed: 'Unnamed',
    unknown: 'Unknown',
    noDetails: 'No details yet. Click “Edit details” to add some.',
    editDetails: 'Edit details',
    addRelative: 'Add relative',
    cancelAdding: 'Cancel adding',
    removeRelation: 'Remove relation',
    cancelRemoving: 'Cancel removing',
    deletePerson: 'Delete person',
    confirmDelete: (name) => `Delete ${name || 'this person'} from the family tree?`,
    hintAdding: 'Click one of the dashed “Add …” cards in the tree to add that relative.',
    hintRemoving: 'Click the relative you want to disconnect from this person.',
    editTitle: (name) => `Edit ${name}`,
    newPerson: 'New person',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    uploadPhoto: 'Upload photo',
    changePhoto: 'Change photo',
    removePhoto: 'Remove',
    photoError: 'That image could not be read. Try a JPEG or PNG.',
    linkExisting: 'Or link someone already in the tree',
    choosePerson: 'Choose a person',

    addFather: 'Add Father',
    addMother: 'Add Mother',
    addSpouse: 'Add Spouse',
    addSon: 'Add Son',
    addDaughter: 'Add Daughter',

    removeSpouseQuestion:
      'You are removing a spouse relationship. Since there are shared children, please choose which parent should keep them in the family tree.',
    keepWithCurrent: 'Keep children with current person',
    keepWithSpouse: 'Keep children with spouse',
  },

  sk: {
    appTitle: 'Rodokmeň',
    loginPrompt: 'Pre pokračovanie zadajte rodinné heslo.',
    password: 'Heslo',
    unlock: 'Odomknúť',
    wrongPassword: 'Nesprávne heslo',
    sessionExpired: 'Prihlásenie vypršalo. Zadajte heslo znova.',
    apiNotSet: 'Adresa API ešte nie je nastavená. Upravte web/config.js.',
    cannotReach: 'Nepodarilo sa spojiť so serverom. Skontrolujte pripojenie a skúste to znova.',
    requestFailed: (status) => `Požiadavka zlyhala (${status})`,

    searchPlaceholder: 'Hľadať osobu…',
    searchLabel: 'Hľadať osobu',
    noOneFound: 'Nikto sa nenašiel',
    lock: 'Zamknúť',
    lockUnsaved: 'Niektoré zmeny ešte nie sú uložené. Napriek tomu zamknúť?',
    toDark: 'Prepnúť na tmavý režim',
    toLight: 'Prepnúť na svetlý režim',
    language: 'Jazyk',
    fitTree: 'Zobraziť celý strom na obrazovke',

    loading: 'Načítava sa rodokmeň…',
    tryAgain: 'Skúsiť znova',
    saving: 'Ukladá sa…',
    saved: 'Uložené',
    notSaved: 'Neuložené',
    retry: 'Skúsiť znova',

    'field:first name': 'Meno',
    'field:last name': 'Priezvisko',
    'field:maiden name': 'Rodné priezvisko',
    'field:birthday': 'Dátum narodenia',
    'field:birthplace': 'Miesto narodenia',
    'field:deathday': 'Dátum úmrtia',
    'field:occupation': 'Povolanie',
    'field:phone': 'Telefón',
    'field:email': 'E-mail',
    'field:address': 'Adresa',
    'field:notes': 'Poznámky',
    'field:avatar': 'Fotografia',
    datePlaceholder: 'napr. 14. 3. 1950 alebo len 1950',
    gender: 'Pohlavie',
    male: 'Muž',
    female: 'Žena',
    bornShort: (year) => `* ${year}`,
    diedShort: (year) => `† ${year}`,

    unnamed: 'Bez mena',
    unknown: 'Neznáma osoba',
    noDetails: 'Zatiaľ bez údajov. Doplníte ich cez „Upraviť údaje“.',
    editDetails: 'Upraviť údaje',
    addRelative: 'Pridať príbuzného',
    cancelAdding: 'Zrušiť pridávanie',
    removeRelation: 'Odstrániť vzťah',
    cancelRemoving: 'Zrušiť odstraňovanie',
    deletePerson: 'Vymazať osobu',
    confirmDelete: (name) => `Naozaj vymazať ${name || 'túto osobu'} z rodokmeňa?`,
    hintAdding: 'Kliknite v rodokmeni na niektorú z prerušovaných kariet „Pridať …“.',
    hintRemoving: 'Kliknite na príbuzného, ktorého chcete od tejto osoby odpojiť.',
    editTitle: (name) => `Upraviť: ${name}`,
    newPerson: 'Nová osoba',
    cancel: 'Zrušiť',
    save: 'Uložiť',
    close: 'Zavrieť',
    uploadPhoto: 'Nahrať fotografiu',
    changePhoto: 'Zmeniť fotografiu',
    removePhoto: 'Odstrániť',
    photoError: 'Obrázok sa nepodarilo načítať. Skúste formát JPEG alebo PNG.',
    linkExisting: 'Alebo prepojiť s osobou, ktorá už je v rodokmeni',
    choosePerson: 'Vyberte osobu',

    addFather: 'Pridať otca',
    addMother: 'Pridať matku',
    addSpouse: 'Pridať partnera',
    addSon: 'Pridať syna',
    addDaughter: 'Pridať dcéru',

    removeSpouseQuestion:
      'Odstraňujete partnerský vzťah. Keďže majú spoločné deti, vyberte, pri ktorom z rodičov majú v rodokmeni zostať.',
    keepWithCurrent: 'Ponechať deti pri tejto osobe',
    keepWithSpouse: 'Ponechať deti pri partnerovi',
  },
};

const LANGUAGES = Object.keys(STRINGS);
const LANG_KEY = 'language';

let lang = initialLanguage();

function initialLanguage() {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (LANGUAGES.includes(stored)) return stored;
  } catch {}
  const preferred = navigator.languages || [navigator.language || ''];
  return preferred.some((l) => /^(sk|cs)\b/i.test(l)) ? 'sk' : 'en';
}

function t(key, ...args) {
  const value = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

// Fills elements marked with data-i18n (text), data-i18n-placeholder, data-i18n-label (aria-label + title).
function translatePage() {
  document.documentElement.lang = lang;
  document.title = t('appTitle');
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
    node.title = t(node.dataset.i18nLabel);
  }
}
