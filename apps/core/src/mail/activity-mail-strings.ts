/**
 * The activity reminders and their unsubscribe pages, in the six languages
 * the other letters exist in.
 *
 * A SEPARATE DICTIONARY FROM `strings.ts`, for the reason
 * `signup-letter-strings.ts` gives: the four generated modules there are
 * rebuilt from a translation memory by `pnpm translate:mail`, and a key added
 * to `MailStrings` would have to be bought into every one of them through that
 * pipeline. These strings were translated by the wordsmith pass (Gemini 3.8
 * Flash) from the English below, which is the operator's own copy, verbatim.
 *
 * TWO PLACEHOLDERS, `{days}` and `{link}`, filled by `fillActivityMail`. The
 * first-scan letter has two first sentences: `joinedWeek` for exactly seven
 * days, `joinedDays` for any other number, so no letter says "a week ago"
 * when it was ten days.
 *
 * THE RULES OF `strings.ts` HOLD HERE TOO, and
 * `tests/unit/activity-mail-message.test.ts` holds these strings to them: no
 * service is named and no dash is used, in any language.
 */
import type { InstanceLanguage } from '../protocol.js';

/** The first-scan reminder: the person never had a photo read. */
export interface FirstScanStrings {
  subject: string;
  /** The first sentence when the account is exactly seven days old. */
  joinedWeek: string;
  /** The first sentence for any other age. Carries `{days}`. */
  joinedDays: string;
  body: string;
  button: string;
}

/** The quiet reminder: the person has not been seen for a while. */
export interface QuietStrings {
  subject: string;
  /** Carries `{days}`. */
  body: string;
  button: string;
}

/** The two lines under every reminder. */
export interface ReminderFooterStrings {
  reason: string;
  /** The plain-text line. Carries `{link}`, the unsubscribe URL. */
  text: string;
  /** The words of the unsubscribe link in the HTML part. */
  linkLabel: string;
}

/** The pages the unsubscribe link opens. */
export interface UnsubscribePageStrings {
  title: string;
  button: string;
  done: string;
  invalid: string;
}

export interface ActivityMailStrings {
  firstScan: FirstScanStrings;
  quiet: QuietStrings;
  footer: ReminderFooterStrings;
  unsubscribe: UnsubscribePageStrings;
}

/** English, hand-written by the operator, and the source every other language translates. */
const ACTIVITY_MAIL_EN: ActivityMailStrings = {
  firstScan: {
    subject: 'Try your first plate photo',
    joinedWeek: 'You joined openplate a week ago and have not tried a plate photo yet.',
    joinedDays: 'You joined openplate {days} days ago and have not tried a plate photo yet.',
    body: 'Take a photo of your next meal, and openplate works out the carbs, protein and calories for you. It takes about ten seconds.',
    button: 'Take a photo',
  },
  quiet: {
    subject: 'Your diary is where you left it',
    body: 'You have not opened openplate for {days} days. Log one meal today and you are back on track.',
    button: 'Open openplate',
  },
  footer: {
    reason: 'You get this email because you asked for reminders when you signed up.',
    text: 'Turn off reminders: {link}',
    linkLabel: 'Turn off reminders',
  },
  unsubscribe: {
    title: 'Turn off reminder emails?',
    button: 'Turn off',
    done: 'Reminder emails are off. You can turn them on again in the app settings.',
    invalid: 'This link does not work any more. You can turn off reminders in the app settings.',
  },
};

/** German, bought from the wordsmith pass (Gemini 3.8 Flash) in the du register the other letters use. */
const ACTIVITY_MAIL_DE: ActivityMailStrings = {
  firstScan: {
    subject: 'Probiere dein erstes Tellerfoto aus',
    joinedWeek: 'Du hast dich vor einer Woche bei openplate angemeldet und noch kein Tellerfoto ausprobiert.',
    joinedDays: 'Du hast dich vor {days} Tagen bei openplate angemeldet und noch kein Tellerfoto ausprobiert.',
    body: 'Fotografiere deine nächste Mahlzeit, und openplate berechnet die Kohlenhydrate, das Protein und die Kalorien für dich. Das dauert etwa zehn Sekunden.',
    button: 'Foto aufnehmen',
  },
  quiet: {
    subject: 'Dein Tagebuch ist noch da, wo du es verlassen hast',
    body: 'Du hast openplate seit {days} Tagen nicht geöffnet. Erfasse heute eine Mahlzeit und du bist wieder im Plan.',
    button: 'openplate öffnen',
  },
  footer: {
    reason: 'Du erhältst diese E-Mail, weil du dich bei deiner Registrierung für Erinnerungen angemeldet hast.',
    text: 'Erinnerungen deaktivieren: {link}',
    linkLabel: 'Erinnerungen deaktivieren',
  },
  unsubscribe: {
    title: 'Erinnerungs-E-Mails deaktivieren?',
    button: 'Deaktivieren',
    done: 'Erinnerungs-E-Mails sind deaktiviert. Du kannst sie in den App-Einstellungen wieder aktivieren.',
    invalid: 'Dieser Link funktioniert nicht mehr. Du kannst Erinnerungen in den App-Einstellungen deaktivieren.',
  },
};

/** French, bought from the wordsmith pass (Gemini 3.8 Flash) in the tu register. */
const ACTIVITY_MAIL_FR: ActivityMailStrings = {
  firstScan: {
    subject: "Essaie ta première photo d'assiette",
    joinedWeek: "Tu as rejoint openplate il y a une semaine et tu n'as pas encore essayé la photo d'assiette.",
    joinedDays: "Tu as rejoint openplate il y a {days} jours et tu n'as pas encore essayé la photo d'assiette.",
    body: 'Prends en photo ton prochain repas, et openplate calcule les glucides, les protéines et les calories pour toi. Cela prend environ dix secondes.',
    button: 'Prendre une photo',
  },
  quiet: {
    subject: "Ton journal est là où tu l'as laissé",
    body: "Tu n'as pas ouvert openplate depuis {days} jours. Enregistre un repas aujourd'hui pour reprendre le fil.",
    button: 'Ouvrir openplate',
  },
  footer: {
    reason: 'Tu reçois cet e-mail car tu as demandé des rappels lors de ton inscription.',
    text: 'Désactiver les rappels : {link}',
    linkLabel: 'Désactiver les rappels',
  },
  unsubscribe: {
    title: 'Désactiver les e-mails de rappel ?',
    button: 'Désactiver',
    done: "Les e-mails de rappel sont désactivés. Tu peux les réactiver dans les paramètres de l'application.",
    invalid: "Ce lien ne fonctionne plus. Tu peux désactiver les rappels dans les paramètres de l'application.",
  },
};

/** Italian, bought from the wordsmith pass (Gemini 3.8 Flash) in the tu register. */
const ACTIVITY_MAIL_IT: ActivityMailStrings = {
  firstScan: {
    subject: 'Prova la tua prima foto del piatto',
    joinedWeek: 'Ti sei iscritto a openplate una settimana fa e non hai ancora provato una foto del piatto.',
    joinedDays: 'Ti sei iscritto a openplate {days} giorni fa e non hai ancora provato una foto del piatto.',
    body: 'Scatta una foto del tuo prossimo pasto e openplate calcola i carboidrati, le proteine e le calorie per te. Ci vogliono circa dieci secondi.',
    button: 'Scatta una foto',
  },
  quiet: {
    subject: 'Il tuo diario è dove lo avevi lasciato',
    body: 'Non apri openplate da {days} giorni. Registra un pasto oggi e sarai di nuovo in carreggiata.',
    button: 'Apri openplate',
  },
  footer: {
    reason: "Ricevi questa email perché hai richiesto i promemoria al momento dell'iscrizione.",
    text: 'Disattiva i promemoria: {link}',
    linkLabel: 'Disattiva i promemoria',
  },
  unsubscribe: {
    title: 'Vuoi disattivare le email di promemoria?',
    button: 'Disattiva',
    done: "Le email di promemoria sono disattivate. Puoi riattivarle nelle impostazioni dell'app.",
    invalid: "Questo link non funziona più. Puoi disattivare i promemoria nelle impostazioni dell'app.",
  },
};

/** Spanish, bought from the wordsmith pass (Gemini 3.8 Flash) in the tú register. */
const ACTIVITY_MAIL_ES: ActivityMailStrings = {
  firstScan: {
    subject: 'Prueba tu primera foto de un plato',
    joinedWeek: 'Te uniste a openplate hace una semana y todavía no has probado una foto de un plato.',
    joinedDays: 'Te uniste a openplate hace {days} días y todavía no has probado una foto de un plato.',
    body: 'Haz una foto de tu próxima comida y openplate calculará los carbohidratos, las proteínas y las calorías por ti. Tarda unos diez segundos.',
    button: 'Haz una foto',
  },
  quiet: {
    subject: 'Tu diario está donde lo dejaste',
    body: 'No has abierto openplate desde hace {days} días. Registra una comida hoy y retomarás el ritmo.',
    button: 'Abrir openplate',
  },
  footer: {
    reason: 'Recibes este correo electrónico porque pediste recordatorios cuando te registraste.',
    text: 'Desactivar recordatorios: {link}',
    linkLabel: 'Desactivar recordatorios',
  },
  unsubscribe: {
    title: '¿Desactivar los correos de recordatorio?',
    button: 'Desactivar',
    done: 'Los correos de recordatorio están desactivados. Puedes activarlos de nuevo en los ajustes de la aplicación.',
    invalid: 'Este enlace ya no funciona. Puedes desactivar los recordatorios en los ajustes de la aplicación.',
  },
};

/** Turkish, bought from the wordsmith pass (Gemini 3.8 Flash) in the informal register. */
const ACTIVITY_MAIL_TR: ActivityMailStrings = {
  firstScan: {
    subject: 'İlk tabak fotoğrafını dene',
    joinedWeek: "openplate'e bir hafta önce katıldın ve henüz bir tabak fotoğrafı denemedin.",
    joinedDays: "openplate'e {days} gün önce katıldın ve henüz bir tabak fotoğrafı denemedin.",
    body: 'Bir sonraki öğününün fotoğrafını çek, openplate senin için karbonhidrat, protein ve kalorileri hesaplasın. Yaklaşık on saniye sürer.',
    button: 'Fotoğraf çek',
  },
  quiet: {
    subject: 'Günlüğün bıraktığın yerde duruyor',
    body: "openplate'i {days} gündür açmadın. Bugün bir öğün kaydet ve yeniden takipte kal.",
    button: "openplate'i aç",
  },
  footer: {
    reason: 'Bu e-postayı, kaydolurken hatırlatıcıları istediğin için alıyorsun.',
    text: 'Hatırlatıcıları kapat: {link}',
    linkLabel: 'Hatırlatıcıları kapat',
  },
  unsubscribe: {
    title: 'Hatırlatıcı e-postaları kapatılsın mı?',
    button: 'Kapat',
    done: 'Hatırlatıcı e-postalar kapatıldı. Uygulama ayarlarından bunları tekrar açabilirsin.',
    invalid: 'Bu bağlantı artık çalışmıyor. Hatırlatıcıları uygulama ayarlarından kapatabilirsin.',
  },
};
export const ACTIVITY_MAIL_STRINGS = {
  en: ACTIVITY_MAIL_EN,
  de: ACTIVITY_MAIL_DE,
  fr: ACTIVITY_MAIL_FR,
  it: ACTIVITY_MAIL_IT,
  es: ACTIVITY_MAIL_ES,
  tr: ACTIVITY_MAIL_TR,
} satisfies Record<InstanceLanguage, ActivityMailStrings>;

/** The two values a reminder string interpolates. */
export interface ActivityMailFillValues {
  days?: number;
  link?: string;
}

/**
 * Substitutes `{days}` and `{link}`. An unknown placeholder, or a known one
 * with no value, is left as written: a `{typo}` in a letter is a bug somebody
 * reports, and an empty gap is not.
 */
export function fillActivityMail(template: string, values: ActivityMailFillValues): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (key === 'days' && values.days !== undefined) return String(values.days);
    if (key === 'link' && values.link !== undefined) return values.link;
    return whole;
  });
}
