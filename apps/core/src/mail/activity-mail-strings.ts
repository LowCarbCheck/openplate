/**
 * The activity reminders and their unsubscribe pages, in the six languages
 * the other letters exist in.
 *
 * A SEPARATE DICTIONARY FROM `strings.ts`, for the reason
 * `signup-letter-strings.ts` gives: the four generated modules there are
 * rebuilt from a translation memory by `pnpm translate:mail`, and a key added
 * to `MailStrings` would have to be bought into every one of them through that
 * pipeline. The English below is the operator's own copy (rewritten on
 * 2026-11-06 to be more encouraging). The five translations came from the
 * wordsmith pass (Gemini 3.8 Flash), with hand fixes for gender-neutral French
 * and Italian.
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
    subject: 'Ready for your first plate photo?',
    joinedWeek: 'You joined openplate a week ago, and we are glad you are here.',
    joinedDays: 'You joined openplate {days} days ago, and we are glad you are here.',
    body: 'The easiest way to start is one photo of your next meal. In about ten seconds, openplate works out the carbs, protein and calories for you.',
    button: 'Take my first photo',
  },
  quiet: {
    subject: 'Pick up where you left off',
    body: 'It has been {days} days since your last visit, and that is fine. Your diary is right where you left it. Log one meal today, and you are back in your rhythm.',
    button: 'Open my diary',
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
    subject: 'Bereit für dein erstes Tellerfoto?',
    joinedWeek: 'Du hast dich vor einer Woche bei openplate angemeldet, und wir freuen uns, dass du da bist.',
    joinedDays: 'Du hast dich vor {days} Tagen bei openplate angemeldet, und wir freuen uns, dass du da bist.',
    body: 'Der einfachste Start ist ein Foto deiner nächsten Mahlzeit. In etwa zehn Sekunden berechnet openplate die Kohlenhydrate, das Protein und die Kalorien für dich.',
    button: 'Mein erstes Foto machen',
  },
  quiet: {
    subject: 'Mach da weiter, wo du aufgehört hast',
    body: 'Dein letzter Besuch ist {days} Tage her, und das ist völlig in Ordnung. Dein Tagebuch wartet genau dort auf dich, wo du es gelassen hast. Erfasse heute eine Mahlzeit, und du bist wieder in deinem Rhythmus.',
    button: 'Mein Tagebuch öffnen',
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
    subject: "Envie d'essayer ta première photo d'assiette ?",
    joinedWeek: 'Tu as rejoint openplate il y a une semaine, et nous sommes ravis de te compter parmi nous.',
    joinedDays: 'Tu as rejoint openplate il y a {days} jours, et nous sommes ravis de te compter parmi nous.',
    body: 'Le moyen le plus simple de commencer est de prendre une photo de ton prochain repas. En une dizaine de secondes, openplate calcule les glucides, les protéines et les calories pour toi.',
    button: 'Prendre ma première photo',
  },
  quiet: {
    subject: 'Reprends là où tu en étais',
    body: "Ta dernière visite remonte à {days} jours, et ce n'est pas grave. Ton journal est exactement là où tu l'as laissé. Enregistre un repas aujourd'hui, et tu retrouveras ton rythme.",
    button: 'Ouvrir mon journal',
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
    subject: 'Che ne dici della tua prima foto del piatto?',
    joinedWeek: 'Hai scelto openplate una settimana fa, e siamo felici di averti qui.',
    joinedDays: 'Hai scelto openplate {days} giorni fa, e siamo felici di averti qui.',
    body: 'Il modo più semplice per iniziare è una foto del tuo prossimo pasto. In circa dieci secondi, openplate calcola per te carboidrati, proteine e calorie.',
    button: 'Scatta la mia prima foto',
  },
  quiet: {
    subject: 'Riprendi da dove hai interrotto',
    body: "Sono passati {days} giorni dalla tua ultima visita, e non c'è problema. Il tuo diario è esattamente dove lo avevi lasciato. Registra un pasto oggi per ritrovare il tuo ritmo.",
    button: 'Apri il mio diario',
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
    subject: '¿A punto para la primera foto de un plato?',
    joinedWeek: 'Te uniste a openplate hace una semana y nos alegra que estés aquí.',
    joinedDays: 'Te uniste a openplate hace {days} días y nos alegra que estés aquí.',
    body: 'La forma más fácil de empezar es hacer una foto de tu próxima comida. En unos diez segundos, openplate calcula los carbohidratos, las proteínas y las calorías por ti.',
    button: 'Hacer mi primera foto',
  },
  quiet: {
    subject: 'Sigue donde lo dejaste',
    body: 'Han pasado {days} días desde tu última visita, y no pasa nada. Tu diario sigue justo donde lo dejaste. Registra una comida hoy y volverás a tu ritmo.',
    button: 'Abrir mi diario',
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
    subject: 'İlk tabak fotoğrafın için hazır mısın?',
    joinedWeek: "openplate'e bir hafta önce katıldın ve burada olmandan mutluyuz.",
    joinedDays: "openplate'e {days} gün önce katıldın ve burada olmandan mutluyuz.",
    body: 'Başlamanın en kolay yolu, bir sonraki öğününün tek bir fotoğrafını çekmek. Yaklaşık on saniye içinde openplate senin için karbonhidrat, protein ve kalori değerlerini hesaplar.',
    button: 'İlk fotoğrafımı çek',
  },
  quiet: {
    subject: 'Kaldığın yerden devam et',
    body: 'Son ziyaretinin üzerinden {days} gün geçti ve bu hiç sorun değil. Günlüğün tam bıraktığın yerde duruyor. Bugün bir öğün kaydet, ritmine hemen geri dön.',
    button: 'Günlüğümü aç',
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
