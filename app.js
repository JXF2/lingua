'use strict';

/*
 * Lingua als Web-App (für iPhone über "Zum Home-Bildschirm"). Nachbau der Android-App:
 * Inhalte kommen aus content.json (per WebExport-Test aus dem Kotlin-Code erzeugt),
 * Übungslogik und Wiederholung entsprechen data/Exercises.kt und data/Store.kt.
 */

// ---------------------------------------------------------------- Sprachen und Kurse

const LANGS = {
  de: { code: 'de', speech: 'de-DE', flag: '🇩🇪' },
  fr: { code: 'fr', speech: 'fr-FR', flag: '🇫🇷' },
  en: { code: 'en', speech: 'en-GB', flag: '🇬🇧' },
};

let CONTENT = null; // { courses: [...], levels: { fr: [...], ... } }

function course(id) {
  if (!id || !CONTENT.courses.includes(id)) return null;
  const [target, base] = id.split('-');
  return { id, target, base, levels: CONTENT.levels[target] };
}

const allCourses = () => CONTENT.courses.map(course);

const lessonsOfLevel = level => level.chapters.flatMap(c => c.lessons);
const lessonsOf = target => CONTENT.levels[target].flatMap(lessonsOfLevel);
const itemsOf = lesson => lesson.words.concat(lesson.sentences);

/** Nachschlagetabellen je Zielsprache (wie Content.Index). */
const INDEX = {};
function index(target) {
  if (INDEX[target]) return INDEX[target];
  const lessons = lessonsOf(target);
  const items = new Map(), lessonOf = new Map(), sentences = new Set(), words = [];
  for (const l of lessons) {
    for (const w of l.words) { items.set(w.id, w); lessonOf.set(w.id, l); words.push(w); }
    for (const s of l.sentences) { items.set(s.id, s); lessonOf.set(s.id, l); sentences.add(s.id); }
  }
  return (INDEX[target] = { lessons, items, lessonOf, sentences, words });
}

const levelOf = (target, lesson) => CONTENT.levels[target].find(lv => lessonsOfLevel(lv).includes(lesson));
const chapterNumber = (level, lesson) => level.chapters.findIndex(c => c.lessons.includes(lesson)) + 1;

// ---------------------------------------------------------------- Einträge und Lücken

const GAP = '_____';
const FOCUS = /\[([^\]|]+)((?:\|[^\]|]+)*)\]/;
const FOCUS_ALL = new RegExp(FOCUS.source, 'g');

/** Text ohne Lücken-Markierung: "[viennes|viens]" → "viennes". */
const text = (item, lang) => item.t[lang].replace(FOCUS_ALL, (_, a) => a);

function focus(item, lang) {
  const raw = item.t[lang];
  const m = FOCUS.exec(raw);
  if (!m) return null;
  const gapped = raw.slice(0, m.index) + GAP + raw.slice(m.index + m[0].length);
  const alternatives = m[2].split('|').filter(s => s.trim());
  return { gapped: gapped.replace(FOCUS_ALL, (_, a) => a), answer: m[1], alternatives };
}

const EDGE = new Set([',', '.', '?', '!', '«', '»', '"', ';', ':', '„', '“']);
function trimEdge(s) {
  let a = 0, b = s.length;
  while (a < b && EDGE.has(s[a])) a++;
  while (b > a && EDGE.has(s[b - 1])) b--;
  return s.slice(a, b);
}

/** Wörter eines Satzes ohne Satzzeichen am Rand. */
const tokens = sentence => sentence.split(' ').map(t => trimEdge(t.trim())).filter(Boolean);

function withGap(sentence, i) {
  const parts = sentence.split(' ');
  const wordParts = parts.map((p, k) => k).filter(k => trimEdge(parts[k].trim()));
  const k = wordParts[i];
  parts[k] = parts[k].replace(trimEdge(parts[k].trim()), GAP);
  return parts.join(' ');
}

// ---------------------------------------------------------------- Zufall

const shuffled = list => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = list => list[Math.floor(Math.random() * list.length)];
const chunked = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const distinctBy = (list, key) => { const seen = new Set(); return list.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

// ---------------------------------------------------------------- Übungen (wie Exercises.kt)

const VOCAB_MODES = ['Meaning', 'Reverse', 'Listening', 'Spell', 'Type', 'Speak'];
const EXERCISE = new Set(['choice', 'type', 'spell', 'build', 'gap']);
const isExercise = step => EXERCISE.has(step.type);

function Exercises(c) {
  const target = c.target, base = c.base;
  const tx = item => text(item, target);
  const meaning = item => text(item, base);
  const tipOf = lesson => lesson.tips[c.id] || null;

  const spellable = item => { const t = tx(item); return t.length >= 3 && t.length <= 9 && /^\p{L}+$/u.test(t); };
  const scramblable = item => { const t = tx(item); return t.length >= 2 && t.length <= 18 && /^[\p{L} '\-]+$/u.test(t); };

  function distractors(correct, primary, fallback, n) {
    return distinctBy(
      shuffled(primary).concat(shuffled(fallback))
        .filter(x => correct == null || x.toLowerCase() !== correct.toLowerCase()),
      x => x.toLowerCase(),
    ).slice(0, n);
  }

  function choice(item, mode, pool) {
    const answerOf = mode === 'Meaning' ? meaning : tx;
    const answer = answerOf(item);
    const options = distractors(answer, pool.map(answerOf), index(target).words.map(answerOf), 2).concat(answer);
    const prompt = mode === 'Reverse' ? meaning(item) : tx(item);
    return { type: 'choice', item, mode, prompt, options: shuffled(options), answer };
  }

  const type = item => ({ type: 'type', item, prompt: meaning(item), answer: tx(item) });

  function spell(item) {
    const word = tx(item);
    const lower = word.toLowerCase();
    const extra = shuffled('abcdefghijklmnopqrstuvwxyz'.split('').filter(ch => !lower.includes(ch))).slice(0, 2);
    return { type: 'spell', item, word, letters: shuffled(Array.from(word).concat(extra)) };
  }

  const otherTokens = (lesson, exclude) =>
    itemsOf(lesson).flatMap(i => tokens(tx(i))).filter(t => !exclude.some(e => e.toLowerCase() === t.toLowerCase()));
  const allTokens = exclude =>
    index(target).lessons.flatMap(itemsOf).flatMap(i => tokens(tx(i))).filter(t => !exclude.some(e => e.toLowerCase() === t.toLowerCase()));

  function build(item, lesson) {
    const sentence = tx(item);
    const tgt = tokens(sentence);
    const extra = distractors(null, otherTokens(lesson, tgt), allTokens(tgt), 2);
    return { type: 'build', item, sentence, target: tgt, tiles: shuffled(tgt.concat(extra)) };
  }

  function gap(item, lesson) {
    const sentence = tx(item);
    const f = focus(item, target);
    if (f) {
      const options = shuffled([...new Set(f.alternatives.concat(f.answer))]);
      return { type: 'gap', item, sentence, gapped: f.gapped, answer: f.answer, options };
    }
    const words = tokens(sentence);
    let candidates = words.map((w, i) => i).filter(i => words[i].length >= 3);
    if (!candidates.length) candidates = words.map((w, i) => i);
    const i = pick(candidates);
    const extra = distractors(words[i], otherTokens(lesson, words), allTokens(words), 2);
    return { type: 'gap', item, sentence, gapped: withGap(sentence, i), answer: words[i], options: shuffled(extra.concat(words[i])) };
  }

  function word(item, lesson) {
    switch (Math.floor(Math.random() * (spellable(item) ? 5 : 4))) {
      case 0: return choice(item, 'Meaning', lesson.words);
      case 1: return choice(item, 'Reverse', lesson.words);
      case 2: return choice(item, 'Listening', lesson.words);
      case 3: return type(item);
      default: return spell(item);
    }
  }

  return {
    tipOf,

    forLesson(lesson, canSpeak) {
      const steps = [];
      const pool = lesson.words;
      let n = 0;
      // Vokabeln in Dreiergruppen vorstellen, dann jedes Wort genau einmal üben.
      for (const chunk of chunked(lesson.words, 3)) {
        for (const w of chunk) steps.push({ type: 'intro', item: w, sentence: false });
        for (const w of shuffled(chunk)) {
          switch (n++ % 5) {
            case 0: steps.push(choice(w, 'Meaning', pool)); break;
            case 1: steps.push(choice(w, 'Listening', pool)); break;
            case 2: steps.push(type(w)); break;
            case 3: steps.push(spellable(w) ? spell(w) : choice(w, 'Reverse', pool)); break;
            default: steps.push(choice(w, 'Reverse', pool));
          }
        }
      }
      const tip = tipOf(lesson);
      if (tip) steps.push({ type: 'explain', tip });
      for (const s of lesson.sentences) {
        if (focus(s, target)) steps.push(gap(s, lesson));
        else { steps.push({ type: 'intro', item: s, sentence: true }); steps.push(build(s, lesson)); }
      }
      if (canSpeak && lesson.sentences.length) {
        const s = pick(lesson.sentences);
        steps.push({ type: 'speak', item: s, text: tx(s) });
      }
      return steps;
    },

    forReview(items) {
      return shuffled(items).map(item => {
        const lesson = index(target).lessonOf.get(item.id);
        if (index(target).sentences.has(item.id)) {
          return focus(item, target) || Math.random() < 0.5 ? gap(item, lesson) : build(item, lesson);
        }
        return word(item, lesson);
      });
    },

    forVocabulary(words, modes, canSpeak) {
      return shuffled(words).map(w => {
        const lesson = index(target).lessonOf.get(w.id);
        let usable = modes.filter(m => m === 'Spell' ? scramblable(w) : m === 'Speak' ? canSpeak : true);
        if (!usable.length) usable = ['Type'];
        switch (pick(usable)) {
          case 'Meaning': return choice(w, 'Meaning', lesson.words);
          case 'Reverse': return choice(w, 'Reverse', lesson.words);
          case 'Listening': return choice(w, 'Listening', lesson.words);
          case 'Spell': return spell(w);
          case 'Speak': return { type: 'speak', item: w, text: tx(w) };
          default: return type(w);
        }
      });
    },

    forGrammar(lessons, count = 12) {
      const sentences = shuffled(lessons.flatMap(l => l.sentences.map(s => [s, l])));
      const focused = sentences.filter(([s]) => focus(s, target));
      const plain = sentences.filter(([s]) => !focus(s, target));
      const picked = shuffled(focused.concat(plain).slice(0, count));
      const withTip = lessons.filter(tipOf);
      const steps = withTip.length ? [{ type: 'explain', tip: tipOf(pick(withTip)) }] : [];
      return steps.concat(picked.map(([s, l]) => focus(s, target) ? gap(s, l) : build(s, l)));
    },

    /** Dieselbe Übung noch einmal, mit neu gemischten Antworten. */
    again(ex) {
      switch (ex.type) {
        case 'choice': return { ...ex, options: shuffled(ex.options) };
        case 'spell': return { ...ex, letters: shuffled(ex.letters) };
        case 'build': return { ...ex, tiles: shuffled(ex.tiles) };
        case 'gap': return { ...ex, options: shuffled(ex.options) };
        default: return { ...ex };
      }
    },
  };
}

// ---------------------------------------------------------------- Speicher (wie Store.kt)

const SCHEMA = 2;
const MAX_LEVEL = 6;
const INTERVALS = [1, 3, 7, 14, 30, 90];
const KEY = 'lingua';

/** Heutiger Tag als Tageszahl seit 1970 (lokale Zeit), wie LocalDate.toEpochDay(). */
function today() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

const Store = {
  data: {},

  load() {
    try { this.data = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { this.data = {}; }
    if (!this.data.schema) this.data.schema = SCHEMA;
    this.save();
  },

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* privater Modus: nur für diese Sitzung */ }
  },

  get course() { return course(this.data.course); },
  set course(c) { this.data.course = c ? c.id : null; this.save(); },

  level(target) {
    const levels = CONTENT.levels[target];
    return levels.find(l => l.name === this.data['level_' + target]) || levels[0];
  },
  setLevel(target, level) { this.data['level_' + target] = level.name; this.save(); },

  get listeningOff() { return Date.now() < (this.data.listening_off_until || 0); },
  pauseListening(minutes = 15) { this.data.listening_off_until = Date.now() + minutes * 60000; this.save(); },

  get vocabModes() {
    const saved = (this.data.vocab_modes || []).filter(m => VOCAB_MODES.includes(m));
    return saved.length ? saved : VOCAB_MODES.slice();
  },
  set vocabModes(modes) { this.data.vocab_modes = modes; this.save(); },

  doneLessons(target) { return new Set(this.data['done_' + target] || []); },

  nextLesson(target, level) {
    const done = this.doneLessons(target);
    return lessonsOfLevel(level).find(l => !done.has(l.id)) || null;
  },

  /** Eintrags-ID → [Stufe 1–6, fällig am Tag]. */
  review(target) { return this.data['review_' + target] || {}; },

  dueItems(target, limit = 15) {
    const t = today();
    return Object.entries(this.review(target))
      .filter(([, s]) => s[1] <= t)
      .sort((a, b) => a[1][1] - b[1][1] || a[1][0] - b[1][0])
      .map(([id]) => index(target).items.get(id)).filter(Boolean)
      .slice(0, limit);
  },

  weakestItems(target, limit = 10) {
    return Object.entries(this.review(target))
      .sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1])
      .map(([id]) => index(target).items.get(id)).filter(Boolean)
      .slice(0, limit);
  },

  completeLesson(target, lesson) {
    const done = this.doneLessons(target);
    done.add(lesson.id);
    this.data['done_' + target] = [...done];
    const review = { ...this.review(target) };
    for (const item of itemsOf(lesson)) if (!review[item.id]) review[item.id] = [1, today() + 1];
    this.data['review_' + target] = review;
    this.registerStudy();
    this.save();
  },

  completeReview(target, results, practice) {
    if (!practice) {
      const t = today();
      const review = { ...this.review(target) };
      for (const [id, correct] of Object.entries(results)) {
        const old = review[id];
        if (!old || old[1] > t) continue;
        const level = correct ? Math.min(old[0] + 1, MAX_LEVEL) : Math.max(old[0] - 1, 1);
        review[id] = [level, t + (correct ? INTERVALS[level - 1] : 1)];
      }
      this.data['review_' + target] = review;
    }
    this.registerStudy();
    this.save();
  },

  get streak() {
    const last = this.data.last_day;
    return last != null && last >= today() - 1 ? this.data.streak || 0 : 0;
  },

  registerStudy() {
    const t = today(), last = this.data.last_day;
    if (last === t) return;
    this.data.streak = last === t - 1 ? (this.data.streak || 0) + 1 : 1;
    this.data.last_day = t;
  },

  reset(target) {
    delete this.data['done_' + target];
    delete this.data['review_' + target];
    this.save();
  },
};

// ---------------------------------------------------------------- Aussprache

const Speaker = {
  lang: 'fr-FR',
  voice: null,
  get available() { return 'speechSynthesis' in window; },

  setLanguage(tag) {
    this.lang = tag;
    this.pickVoice();
  },

  pickVoice() {
    if (!this.available) return;
    const voices = speechSynthesis.getVoices();
    const prefix = this.lang.slice(0, 2);
    this.voice = voices.find(v => v.lang.replace('_', '-') === this.lang && v.localService)
      || voices.find(v => v.lang.replace('_', '-') === this.lang)
      || voices.find(v => v.lang.toLowerCase().startsWith(prefix)) || null;
  },

  /** true, wenn das Gerät Stimmen kennt, aber keine für die Kurssprache. */
  get voiceMissing() {
    if (!this.available) return true;
    const voices = speechSynthesis.getVoices();
    return voices.length > 0 && !voices.some(v => v.lang.toLowerCase().startsWith(this.lang.slice(0, 2)));
  },

  speak(t, slow = false) {
    if (!this.available) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = this.lang;
    if (this.voice) u.voice = this.voice;
    u.rate = slow ? 0.6 : 0.95;
    speechSynthesis.speak(u);
  },

  stop() { if (this.available) speechSynthesis.cancel(); },
};

if (Speaker.available) speechSynthesis.addEventListener?.('voiceschanged', () => Speaker.pickVoice());

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const canSpeak = !!Recognition;

// ---------------------------------------------------------------- Texte (wie ui/Strings.kt)

const LEVEL_NAMES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LEVEL_LABELS = {
  de: ['Einstieg', 'Grundlagen', 'Mittelstufe', 'Gute Mittelstufe', 'Fortgeschritten', 'Annähernd muttersprachlich'],
  en: ['Beginner', 'Elementary', 'Intermediate', 'Upper intermediate', 'Advanced', 'Proficient'],
  fr: ['Débutant', 'Élémentaire', 'Intermédiaire', 'Intermédiaire avancé', 'Avancé', 'Maîtrise'],
};
const MODE_NAMES = {
  de: ['Bedeutung wählen', 'Übersetzen', 'Hören', 'Buchstabensalat', 'Schreiben', 'Sprechen'],
  en: ['Choose the meaning', 'Translate', 'Listen', 'Letter jumble', 'Write', 'Speak'],
  fr: ['Choisir le sens', 'Traduire', 'Écouter', 'Lettres mélangées', 'Écrire', 'Parler'],
};
const deName = l => ({ fr: 'Französisch', en: 'Englisch', de: 'Deutsch' })[l];
const enName = l => ({ fr: 'French', en: 'English', de: 'German' })[l];
const frName = l => ({ fr: 'français', en: 'anglais', de: 'allemand' })[l];
const levelLabel = (base, level) => `${level} · ${LEVEL_LABELS[base][LEVEL_NAMES.indexOf(level)] || ''}`;

const STRINGS = {
  de: {
    langName: deName, learn: 'Lernen', review: 'Wiederholen', profile: 'Profil', greeting: 'Bereit für heute?',
    continueLearning: 'Weiter lernen', levelFinished: 'Stufe abgeschlossen!',
    levelFinishedHint: 'Wähle oben die nächste Stufe oder wiederhole deine Vokabeln.', start: 'Starten',
    lesson: n => `Lektion ${n}`, chapter: n => `Unit ${n}`, levelName: l => levelLabel('de', l),
    newWord: 'Neuer Ausdruck', newSentence: 'Neuer Satz', grammar: 'Grammatik', grammarTab: 'Grammatik',
    grammarHint: 'Alle Erklärungen zum Nachschlagen – mit Tabellen und Animationen.', animation: 'Schritt für Schritt',
    replay: 'Nochmal abspielen', examples: 'Beispiele', promptMeaning: 'Was bedeutet das?',
    promptReverse: l => `Wie sagt man das auf ${deName(l)}?`, promptListening: 'Was hörst du?',
    promptSpell: l => `Setze das Wort auf ${deName(l)} zusammen`, promptType: l => `Schreib es auf ${deName(l)}`,
    promptBuild: l => `Bilde den Satz auf ${deName(l)}`, promptGap: 'Ergänze die Lücke', promptSpeak: 'Sprich den Satz nach',
    tapToSpeak: 'Tippe zum Sprechen', listening: 'Ich höre zu …', cantListen: 'Kann gerade nicht hören', cantSpeak: 'Kann gerade nicht sprechen',
    spokenWell: 'Gut ausgesprochen!', spokenAlmost: 'Fast – versuch es noch einmal', youSaid: t => `Du hast gesagt: „${t}“`,
    noMic: 'Spracherkennung nicht verfügbar – du kannst die Übung überspringen.',
    tapAgainSlow: 'Nochmal tippen für langsam', typeHere: 'Hier eintippen', check: 'Prüfen',
    accentHint: 'Richtig – achte auf die Akzente:', correctAnswerIs: 'Richtig wäre:', next: 'Weiter', gotIt: 'Verstanden',
    correct: 'Richtig!', withMistakes: 'Geschafft – merk dir:',
    quitTitle: 'Lektion beenden?', quitText: 'Dein Fortschritt in dieser Lektion geht verloren.', quit: 'Beenden', keepGoing: 'Weiterlernen',
    lessonDone: 'Lektion geschafft!', reviewDone: 'Wiederholung geschafft!', trainingDone: 'Training geschafft!',
    accuracy: 'Richtig beim ersten Mal', newVocabulary: 'Neu in deiner Wiederholung', reviewedItems: 'Geübt',
    dueCount: n => n === 1 ? '1 Eintrag fällig' : `${n} Einträge fällig`, nothingDue: 'Alles wiederholt',
    nothingDueHint: 'Für heute ist nichts mehr fällig. Super!',
    emptyReview: 'Schließe eine Lektion ab – ihre Inhalte landen dann hier und kommen in wachsenden Abständen wieder.',
    startReview: 'Wiederholung starten', practiceAnyway: 'Trotzdem üben', training: 'Training', vocabTraining: 'Vokabeltraining',
    vocabTrainingHint: 'Nur Wörter und Ausdrücke – Übungsarten frei wählbar', chooseModes: 'Welche Übungen möchtest du?',
    modeName: m => MODE_NAMES.de[VOCAB_MODES.indexOf(m)], grammarTraining: 'Grammatiktraining',
    grammarTrainingHint: 'Grammatikformen wählen und Sätze bauen', level: n => `Stufe ${n}`, levelsTitle: 'Dein Wortschatz',
    courses: 'Kurse', chooseLevel: 'Wo möchtest du einsteigen?', items: 'Einträge', lessons: 'Lektionen', streak: 'Tage in Folge',
    resetProgress: 'Fortschritt zurücksetzen', resetTitle: 'Fortschritt zurücksetzen?',
    resetText: l => `Alle abgeschlossenen Lektionen und Wiederholungen im ${deName(l)}-Kurs werden gelöscht.`,
    reset: 'Zurücksetzen', cancel: 'Abbrechen',
    noVoice: l => `Keine Stimme für ${deName(l)} gefunden. Auf dem iPhone: Einstellungen › Bedienungshilfen › Gesprochene Inhalte › Stimmen › ${deName(l)}.`,
    install: 'Tipp: In Safari auf „Teilen“ und „Zum Home-Bildschirm“ tippen – dann startet Lingua wie eine App und funktioniert auch offline.',
  },
  en: {
    langName: enName, learn: 'Learn', review: 'Review', profile: 'Profile', greeting: 'Ready for today?',
    continueLearning: 'Continue', levelFinished: 'Level completed!',
    levelFinishedHint: 'Pick the next level above or review your vocabulary.', start: 'Start',
    lesson: n => `Lesson ${n}`, chapter: n => `Unit ${n}`, levelName: l => levelLabel('en', l),
    newWord: 'New expression', newSentence: 'New sentence', grammar: 'Grammar', grammarTab: 'Grammar',
    grammarHint: 'All explanations to look up – with tables and animations.', animation: 'Step by step',
    replay: 'Play again', examples: 'Examples', promptMeaning: 'What does this mean?',
    promptReverse: l => `How do you say this in ${enName(l)}?`, promptListening: 'What do you hear?',
    promptSpell: l => `Put the ${enName(l)} word together`, promptType: l => `Write it in ${enName(l)}`,
    promptBuild: l => `Build the sentence in ${enName(l)}`, promptGap: 'Fill in the gap', promptSpeak: 'Say the sentence out loud',
    tapToSpeak: 'Tap to speak', listening: 'Listening …', cantListen: "Can't listen right now", cantSpeak: "Can't speak right now",
    spokenWell: 'Well pronounced!', spokenAlmost: 'Almost – try again', youSaid: t => `You said: "${t}"`,
    noMic: 'Speech recognition is not available – you can skip this exercise.',
    tapAgainSlow: 'Tap again to hear it slowly', typeHere: 'Type here', check: 'Check',
    accentHint: 'Correct – mind the accents:', correctAnswerIs: 'Correct answer:', next: 'Continue', gotIt: 'Got it',
    correct: 'Correct!', withMistakes: 'Done – remember:',
    quitTitle: 'Quit the lesson?', quitText: 'Your progress in this lesson will be lost.', quit: 'Quit', keepGoing: 'Keep learning',
    lessonDone: 'Lesson complete!', reviewDone: 'Review complete!', trainingDone: 'Training complete!',
    accuracy: 'Right first time', newVocabulary: 'Added to your review', reviewedItems: 'Practised',
    dueCount: n => n === 1 ? '1 item due' : `${n} items due`, nothingDue: 'All caught up',
    nothingDueHint: 'Nothing left to review today. Great job!',
    emptyReview: 'Finish a lesson – its content will show up here and come back at growing intervals.',
    startReview: 'Start review', practiceAnyway: 'Practise anyway', training: 'Training', vocabTraining: 'Vocabulary training',
    vocabTrainingHint: 'Words and phrases only – choose your exercise types', chooseModes: 'Which exercises would you like?',
    modeName: m => MODE_NAMES.en[VOCAB_MODES.indexOf(m)], grammarTraining: 'Grammar training',
    grammarTrainingHint: 'Choose the right forms and build sentences', level: n => `Level ${n}`, levelsTitle: 'Your vocabulary',
    courses: 'Courses', chooseLevel: 'Where do you want to start?', items: 'Items', lessons: 'Lessons', streak: 'Day streak',
    resetProgress: 'Reset progress', resetTitle: 'Reset progress?',
    resetText: l => `All completed lessons and reviews in the ${enName(l)} course will be deleted.`,
    reset: 'Reset', cancel: 'Cancel',
    noVoice: l => `No ${enName(l)} voice found. On iPhone: Settings › Accessibility › Spoken Content › Voices › ${enName(l)}.`,
    install: 'Tip: in Safari tap "Share" and "Add to Home Screen" – Lingua then starts like an app and also works offline.',
  },
  fr: {
    langName: l => frName(l)[0].toUpperCase() + frName(l).slice(1), learn: 'Apprendre', review: 'Réviser', profile: 'Profil',
    greeting: "Prêt pour aujourd'hui ?", continueLearning: 'Continuer', levelFinished: 'Niveau terminé !',
    levelFinishedHint: 'Choisis le niveau suivant en haut ou révise ton vocabulaire.', start: 'Commencer',
    lesson: n => `Leçon ${n}`, chapter: n => `Unité ${n}`, levelName: l => levelLabel('fr', l),
    newWord: 'Nouvelle expression', newSentence: 'Nouvelle phrase', grammar: 'Grammaire', grammarTab: 'Grammaire',
    grammarHint: 'Toutes les explications à consulter – avec tableaux et animations.', animation: 'Étape par étape',
    replay: 'Rejouer', examples: 'Exemples', promptMeaning: 'Que signifie ceci ?',
    promptReverse: l => `Comment dit-on en ${frName(l)} ?`, promptListening: "Qu'entends-tu ?",
    promptSpell: l => `Assemble le mot en ${frName(l)}`, promptType: l => `Écris-le en ${frName(l)}`,
    promptBuild: l => `Construis la phrase en ${frName(l)}`, promptGap: 'Complète la phrase', promptSpeak: 'Répète la phrase à voix haute',
    tapToSpeak: 'Appuie pour parler', listening: "J'écoute …", cantListen: 'Je ne peux pas écouter', cantSpeak: 'Je ne peux pas parler',
    spokenWell: 'Bien prononcé !', spokenAlmost: 'Presque – réessaie', youSaid: t => `Tu as dit : « ${t} »`,
    noMic: "La reconnaissance vocale n'est pas disponible – tu peux passer cet exercice.",
    tapAgainSlow: 'Appuie encore pour ralentir', typeHere: 'Écris ici', check: 'Vérifier',
    accentHint: 'Correct – attention aux accents :', correctAnswerIs: 'La bonne réponse :', next: 'Continuer', gotIt: 'Compris',
    correct: 'Correct !', withMistakes: 'Réussi – à retenir :',
    quitTitle: 'Quitter la leçon ?', quitText: 'Ta progression dans cette leçon sera perdue.', quit: 'Quitter', keepGoing: 'Continuer',
    lessonDone: 'Leçon terminée !', reviewDone: 'Révision terminée !', trainingDone: 'Entraînement terminé !',
    accuracy: 'Réussi du premier coup', newVocabulary: 'Ajouté à tes révisions', reviewedItems: 'Révisé',
    dueCount: n => n === 1 ? '1 élément à réviser' : `${n} éléments à réviser`, nothingDue: 'Tout est révisé',
    nothingDueHint: "Plus rien à réviser aujourd'hui. Bravo !",
    emptyReview: 'Termine une leçon – son contenu arrivera ici et reviendra à intervalles croissants.',
    startReview: 'Commencer la révision', practiceAnyway: "S'entraîner quand même", training: 'Entraînement', vocabTraining: 'Vocabulaire',
    vocabTrainingHint: 'Uniquement des mots et expressions – exercices au choix', chooseModes: 'Quels exercices veux-tu faire ?',
    modeName: m => MODE_NAMES.fr[VOCAB_MODES.indexOf(m)], grammarTraining: 'Grammaire',
    grammarTrainingHint: 'Choisir les bonnes formes et construire des phrases', level: n => `Niveau ${n}`, levelsTitle: 'Ton vocabulaire',
    courses: 'Cours', chooseLevel: 'Par quel niveau veux-tu commencer ?', items: 'Éléments', lessons: 'Leçons', streak: "Jours d'affilée",
    resetProgress: 'Réinitialiser la progression', resetTitle: 'Réinitialiser la progression ?',
    resetText: l => `Toutes les leçons terminées et les révisions du cours d'${frName(l)} seront supprimées.`,
    reset: 'Réinitialiser', cancel: 'Annuler',
    noVoice: l => `Aucune voix en ${frName(l)} trouvée. Sur iPhone : Réglages › Accessibilité › Contenu énoncé › Voix.`,
    install: "Astuce : dans Safari, touche « Partager » puis « Sur l'écran d'accueil » – Lingua s'ouvre alors comme une app, même hors ligne.",
  },
};

let S = STRINGS.de;

const courseTitle = c => `${LANGS[c.target].flag} ${STRINGS[c.base].langName(c.target)}`;
function courseSubtitle(c) {
  const lv = c.levels.length === 1 ? c.levels[0].name : `${c.levels[0].name}–${c.levels[c.levels.length - 1].name}`;
  const n = c.levels.reduce((sum, l) => sum + lessonsOfLevel(l).length, 0);
  return { en: `Explained in English · ${lv} · ${n} lessons`, fr: `Expliqué en français · ${lv} · ${n} leçons`, de: `Auf Deutsch erklärt · ${lv} · ${n} Lektionen` }[c.base];
}

// ---------------------------------------------------------------- DOM-Helfer

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const PATHS = {
  school: 'M5,13.18v4L12,21l7,-3.82v-4L12,17l-7,-3.82zM12,3L1,9l11,6 9,-4.91V17h2V9L12,3z',
  refresh: 'M17.65,6.35C16.2,4.9 14.21,4 12,4c-4.42,0 -7.99,3.58 -7.99,8s3.57,8 7.99,8c3.73,0 6.84,-2.55 7.73,-6h-2.08c-0.82,2.33 -3.04,4 -5.65,4 -3.31,0 -6,-2.69 -6,-6s2.69,-6 6,-6c1.66,0 3.14,0.69 4.22,1.78L13,11h7V4l-2.35,2.35z',
  book: 'M21,5c-1.11,-0.35 -2.33,-0.5 -3.5,-0.5 -1.95,0 -4.05,0.4 -5.5,1.5 -1.45,-1.1 -3.55,-1.5 -5.5,-1.5S2.45,4.9 1,6v14.65c0,0.25 0.25,0.5 0.5,0.5 0.1,0 0.15,-0.05 0.25,-0.05C3.1,20.45 5.05,20 6.5,20c1.95,0 4.05,0.4 5.5,1.5 1.35,-0.85 3.8,-1.5 5.5,-1.5 1.65,0 3.35,0.3 4.75,1.05 0.1,0.05 0.15,0.05 0.25,0.05 0.25,0 0.5,-0.25 0.5,-0.5V6c-0.6,-0.45 -1.25,-0.75 -2,-1zM21,18.5c-1.1,-0.35 -2.3,-0.5 -3.5,-0.5 -1.7,0 -4.15,0.65 -5.5,1.5V8c1.35,-0.85 3.8,-1.5 5.5,-1.5 1.2,0 2.4,0.15 3.5,0.5v11.5z',
  person: 'M12,12c2.21,0 4,-1.79 4,-4s-1.79,-4 -4,-4 -4,1.79 -4,4 1.79,4 4,4zM12,14c-2.67,0 -8,1.34 -8,4v2h16v-2c0,-2.66 -5.33,-4 -8,-4z',
  speaker: 'M3,9v6h4l5,5V4L7,9H3zM16.5,12c0,-1.77 -1.02,-3.29 -2.5,-4.03v8.05c1.48,-0.73 2.5,-2.25 2.5,-4.02zM14,3.23v2.06c2.89,0.86 5,3.54 5,6.71s-2.11,5.85 -5,6.71v2.06c4.01,-0.91 7,-4.49 7,-8.77s-2.99,-7.86 -7,-8.77z',
  mic: 'M12,14c1.66,0 2.99,-1.34 2.99,-3L15,5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6c0,1.66 1.34,3 3,3zM17.3,11c0,3 -2.54,5.1 -5.3,5.1S6.7,14 6.7,11L5,11c0,3.41 2.72,6.23 6,6.72L11,21h2v-3.28c3.28,-0.48 6,-3.3 6,-6.72h-1.7z',
  flame: 'M13.5,0.67s0.74,2.65 0.74,4.8c0,2.06 -1.35,3.73 -3.41,3.73 -2.07,0 -3.63,-1.67 -3.63,-3.73l0.03,-0.36C5.21,7.51 4,10.62 4,14c0,4.42 3.58,8 8,8s8,-3.58 8,-8C20,8.61 17.41,3.8 13.5,0.67zM11.71,19c-1.78,0 -3.22,-1.4 -3.22,-3.14 0,-1.62 1.05,-2.76 2.81,-3.12 1.77,-0.36 3.6,-1.21 4.62,-2.58 0.39,1.29 0.59,2.65 0.59,4.04 0,2.65 -2.15,4.8 -4.8,4.8z',
  check: 'M9,16.17L4.83,12l-1.42,1.41L9,19 21,7l-1.41,-1.41z',
  close: 'M19,6.41L17.59,5 12,10.59 6.41,5 5,6.41 10.59,12 5,17.59 6.41,19 12,13.41 17.59,19 19,17.59 13.41,12z',
  back: 'M20,11H7.83l5.59,-5.59L12,4l-8,8 8,8 1.41,-1.41L7.83,13H20v-2z',
  play: 'M8,5v14l11,-7z',
};

const icon = name => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', PATHS[name]);
  svg.append(p);
  return svg;
};

const vibrate = () => { try { navigator.vibrate?.(40); } catch (e) { /* iOS kennt kein vibrate */ } };

/**
 * Lautsprecher-Knopf: erster Tipp normal, nächster langsam, dann wieder normal.
 * Mit autoPlay wurde der Text schon einmal gesprochen, der erste Tipp ist dann langsam.
 */
function audioButton(t, { size = 48, autoPlay = false } = {}) {
  let slowNext = autoPlay;
  return h('button', {
    class: 'audio', style: `width:${size}px;height:${size}px`, 'aria-label': 'Anhören',
    onclick: e => { e.stopPropagation(); Speaker.speak(t, slowNext); slowNext = !slowNext; },
  }, icon('speaker'));
}

function dialog({ title, body, actions }) {
  const scrim = h('div', { class: 'scrim', onclick: e => { if (e.target === scrim) close(); } },
    h('div', { class: 'dialog', role: 'dialog' }, h('h3', {}, title), body, h('div', { class: 'actions' }, actions(close))));
  function close() { scrim.remove(); }
  document.body.append(scrim);
  return close;
}

// ---------------------------------------------------------------- App-Zustand

const app = {
  screen: { name: 'home' },
  tab: 0,
  onboardingPick: null,
  grammarLevel: null,
  exercises: null,
};

function progress(c) {
  const level = Store.level(c.target);
  return {
    level,
    done: Store.doneLessons(c.target),
    next: Store.nextLesson(c.target, level),
    review: Store.review(c.target),
    due: Store.dueItems(c.target, Infinity).length,
    streak: Store.streak,
  };
}

function render() {
  const root = document.getElementById('app');
  const c = Store.course;
  if (!c) { root.replaceChildren(onboarding()); return; }
  S = STRINGS[c.base];
  document.documentElement.lang = c.base;
  if (!app.exercises || app.exercises.courseId !== c.id) {
    app.exercises = Exercises(c);
    app.exercises.courseId = c.id;
    Speaker.setLanguage(LANGS[c.target].speech);
  }
  const s = app.screen;
  if (s.name === 'session') { renderSession(root, c); return; }
  const p = progress(c);
  if (s.name === 'grammar') root.replaceChildren(grammarDetail(c, s.lesson));
  else if (s.name === 'result') root.replaceChildren(resultScreen(c, s, p));
  else root.replaceChildren(home(c, p));
}

const go = screen => { Speaker.stop(); app.screen = screen; render(); };

// ---------------------------------------------------------------- Erster Start

function courseCard(c, selected, onclick) {
  return h('button', { class: 'card' + (selected ? ' selected' : ''), onclick },
    h('div', { class: 'row', style: 'padding:18px' },
      h('div', { class: 'grow stack-s' },
        h('div', { class: 'title-l' }, courseTitle(c)),
        h('div', { class: 'body-m muted' }, courseSubtitle(c))),
      selected && h('span', { style: 'color:var(--primary)' }, icon('check'))));
}

function onboarding() {
  const choice = app.onboardingPick;
  if (choice && choice.levels.length > 1) {
    S = STRINGS[choice.base];
    return h('div', { class: 'screen' }, h('div', { class: 'scroll stack' },
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'icon-btn', 'aria-label': 'Zurück', onclick: () => { app.onboardingPick = null; render(); } }, icon('back'))),
      h('h2', { class: 'h2' }, S.chooseLevel),
      choice.levels.map(level => h('button', {
        class: 'card', onclick: () => { Store.setLevel(choice.target, level); Store.course = choice; app.onboardingPick = null; render(); },
      }, h('div', { style: 'padding:18px' },
        h('div', { class: 'title-l' }, S.levelName(level.name)),
        h('div', { class: 'body-m muted' }, `${lessonsOfLevel(level).length} ${S.lessons}`))))));
  }
  return h('div', { class: 'screen' }, h('div', { class: 'scroll stack' },
    h('div', { class: 'display', style: 'color:var(--primary);margin-top:32px' }, 'Lingua'),
    h('div', { class: 'title-l pre' }, 'Was möchtest du lernen?\nWhat do you want to learn?'),
    allCourses().map(c => courseCard(c, false, () => {
      if (c.levels.length === 1) Store.course = c; else app.onboardingPick = c;
      render();
    })),
    !isStandalone() && h('div', { class: 'info muted' }, STRINGS.de.install)));
}

const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

// ---------------------------------------------------------------- Startbildschirm mit Tabs

function home(c, p) {
  const tabs = [
    ['school', S.learn], ['refresh', S.review], ['book', S.grammarTab], ['person', S.profile],
  ];
  const body = [courseTab, reviewTab, grammarTab, profileTab][app.tab](c, p);
  return h('div', { class: 'screen' },
    body,
    h('nav', { class: 'nav' }, tabs.map(([ic, label], i) =>
      h('button', { class: app.tab === i ? 'on' : '', onclick: () => { app.tab = i; render(); } },
        h('span', { class: 'pill' }, icon(ic), i === 1 && p.due > 0 && h('span', { class: 'badge' }, p.due)),
        label))));
}

function trainingLessons(c, p) {
  const doneInLevel = lessonsOfLevel(p.level).filter(l => p.done.has(l.id));
  if (doneInLevel.length) return doneInLevel;
  const doneAll = lessonsOf(c.target).filter(l => p.done.has(l.id));
  return doneAll.length ? doneAll : lessonsOfLevel(p.level);
}

function startLesson(lesson) {
  go({ name: 'session', kind: 'lesson', lesson, steps: app.exercises.forLesson(lesson, canSpeak) });
}

function courseTab(c, p) {
  const level = p.level;
  const levelLessons = lessonsOfLevel(level);
  const next = p.next;
  let hero;
  if (!next) {
    hero = h('div', { class: 'hero' },
      h('div', { class: 'h2' }, S.levelFinished),
      h('div', { class: 'body-m dim' }, S.levelFinishedHint));
  } else {
    const ch = chapterNumber(level, next);
    const num = level.chapters[ch - 1].lessons.indexOf(next) + 1;
    const doneCount = levelLessons.filter(l => p.done.has(l.id)).length;
    hero = h('div', { class: 'hero' },
      h('div', { class: 'body-s dim', style: 'font-weight:600;letter-spacing:0.5px' },
        `${S.continueLearning.toUpperCase()} · ${level.name} · ${S.chapter(ch)}, ${S.lesson(num)}`),
      h('div', { class: 'h2' }, next.title[c.base]),
      h('div', { class: 'body-m dim ellipsis' }, next.words.map(w => text(w, c.target)).join(' · ')),
      h('div', { class: 'bar', style: 'margin-top:10px' }, h('div', { style: `width:${doneCount * 100 / levelLessons.length}%` })),
      h('button', { class: 'btn inverse', style: 'margin-top:14px', onclick: () => startLesson(next) }, S.start));
  }
  return h('div', { class: 'scroll' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' },
        h('div', { class: 'body-l muted' }, S.greeting),
        h('h1', { class: 'h1' }, S.langName(c.target))),
      streakChip(p.streak)),
    c.levels.length > 1 && h('div', { class: 'chip-row', style: 'margin-top:16px' }, c.levels.map(lv => {
      const finished = lessonsOfLevel(lv).every(l => p.done.has(l.id));
      return h('button', { class: 'chip' + (lv === level ? ' active' : ''), onclick: () => { Store.setLevel(c.target, lv); render(); } },
        finished && icon('check'), lv.name);
    })),
    h('div', { style: 'margin:16px 0' }, hero),
    level.chapters.map((chapter, ci) => {
      const done = chapter.lessons.filter(l => p.done.has(l.id)).length;
      return [
        h('div', { class: 'chapter-head label' },
          h('span', {}, `${S.chapter(ci + 1).toUpperCase()} · ${chapter.title[c.base]}`),
          h('span', {}, `${done}/${chapter.lessons.length}`)),
        chapter.lessons.map((lesson, li) => {
          const isDone = p.done.has(lesson.id), current = lesson === next;
          return h('button', { class: 'card-m lesson' + (current ? ' selected' : ''), onclick: () => startLesson(lesson) },
            h('div', { class: 'dot' + (isDone ? ' done' : current ? ' current' : '') }, isDone ? icon('check') : String(li + 1)),
            h('div', { class: 'grow' },
              h('div', { class: 'title-m' }, lesson.title[c.base]),
              h('div', { class: 'body-s muted ellipsis' }, lesson.words.slice(0, 3).map(w => text(w, c.target)).join(', '))));
        }),
      ];
    }));
}

function streakChip(days) {
  return h('div', { class: 'streak' }, icon('flame'), String(days));
}

function reviewTab(c, p) {
  const count = Object.keys(p.review).length;
  let main;
  if (!count) {
    main = [h('span', { style: 'color:var(--primary)' }, icon('refresh')), h('div', { class: 'body-l muted' }, S.emptyReview)];
  } else if (p.due > 0) {
    main = [
      h('div', { class: 'big-num' }, p.due),
      h('div', { class: 'title-m' }, S.dueCount(p.due)),
      h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => startReview(c, false) }, S.startReview),
    ];
  } else {
    main = [
      h('span', { style: 'color:var(--tertiary)' }, icon('check')),
      h('div', { class: 'title-l' }, S.nothingDue),
      h('div', { class: 'body-m muted' }, S.nothingDueHint),
      h('button', { class: 'btn outline', style: 'margin-top:8px', onclick: () => startReview(c, true) }, S.practiceAnyway),
    ];
  }
  const counts = [1, 2, 3, 4, 5, 6].map(lv => Object.values(p.review).filter(s => s[0] === lv).length);
  const max = Math.max(1, ...counts);
  return h('div', { class: 'scroll stack' },
    h('h1', { class: 'h1' }, S.review),
    h('div', { class: 'card pad-l center-col' }, main),
    h('div', { class: 'label', style: 'margin-top:24px' }, S.training),
    trainingCard(S.vocabTraining, S.vocabTrainingHint, () => chooseVocabModes(c, p)),
    h('div', { style: 'margin-top:8px' }, trainingCard(S.grammarTraining, S.grammarTrainingHint, () =>
      go({ name: 'session', kind: 'training', steps: app.exercises.forGrammar(trainingLessons(c, p)) }))),
    count > 0 && [
      h('div', { class: 'label', style: 'margin-top:24px' }, S.levelsTitle),
      counts.map((n, i) => h('div', { class: 'level-row', style: 'margin-top:8px' },
        h('span', { class: 'muted' }, S.level(i + 1)),
        h('div', { class: 'bar track' }, h('div', { style: `width:${n * 100 / max}%` })),
        h('b', {}, n))),
    ]);
}

function startReview(c, practice) {
  const items = practice ? Store.weakestItems(c.target) : Store.dueItems(c.target);
  if (items.length) go({ name: 'session', kind: practice ? 'practice' : 'review', steps: app.exercises.forReview(items) });
}

function trainingCard(title, hint, onclick) {
  return h('button', { class: 'card-m', onclick },
    h('div', { style: 'padding:16px' }, h('div', { class: 'title-m' }, title), h('div', { class: 'body-s muted' }, hint)));
}

function chooseVocabModes(c, p) {
  const selected = new Set(Store.vocabModes);
  let startBtn;
  const rows = VOCAB_MODES.map(mode => {
    const box = h('span', { class: 'box' });
    const paint = () => { box.className = 'box' + (selected.has(mode) ? ' on' : ''); box.replaceChildren(selected.has(mode) ? icon('check') : ''); };
    paint();
    return h('button', {
      class: 'check-row', role: 'checkbox',
      onclick: () => { selected.has(mode) ? selected.delete(mode) : selected.add(mode); paint(); startBtn.disabled = !selected.size; },
    }, box, S.modeName(mode));
  });
  dialog({
    title: S.chooseModes,
    body: h('div', {}, rows),
    actions: close => [
      h('button', { class: 'text-btn', onclick: close }, S.cancel),
      startBtn = h('button', {
        class: 'text-btn', onclick: () => {
          close();
          const modes = VOCAB_MODES.filter(m => selected.has(m));
          Store.vocabModes = modes;
          const words = shuffled(trainingLessons(c, p).flatMap(l => l.words)).slice(0, 15);
          go({ name: 'session', kind: 'training', steps: app.exercises.forVocabulary(words, modes, canSpeak) });
        },
      }, S.start),
    ],
  });
}

function grammarTab(c, p) {
  const level = c.levels.find(l => l.name === app.grammarLevel) || p.level;
  return h('div', { class: 'scroll' },
    h('h1', { class: 'h1' }, S.grammar),
    h('div', { class: 'body-m muted' }, S.grammarHint),
    c.levels.length > 1 && h('div', { class: 'chip-row', style: 'margin-top:12px' }, c.levels.map(lv =>
      h('button', { class: 'chip' + (lv === level ? ' active' : ''), onclick: () => { app.grammarLevel = lv.name; render(); } }, lv.name))),
    level.chapters.map((chapter, ci) => [
      h('div', { class: 'label', style: 'padding:24px 0 8px' }, `${S.chapter(ci + 1).toUpperCase()} · ${chapter.title[c.base]}`),
      chapter.lessons.filter(l => l.tips[c.id]).map(lesson => h('button', {
        class: 'card-m lesson', onclick: () => go({ name: 'grammar', lesson }),
      },
      h('div', { class: 'grow' },
        h('div', { class: 'title-m' }, lesson.tips[c.id].title),
        h('div', { class: 'body-s muted' }, lesson.title[c.base])),
      p.done.has(lesson.id) && h('span', { class: 'check-s' }, icon('check')))),
    ]));
}

function profileTab(c, p) {
  const all = c.levels.reduce((n, l) => n + lessonsOfLevel(l).length, 0);
  return h('div', { class: 'scroll stack' },
    h('h1', { class: 'h1' }, S.profile),
    h('div', { class: 'stats' },
      stat(p.streak, S.streak), stat(Object.keys(p.review).length, S.items), stat(`${p.done.size}/${all}`, S.lessons)),
    Speaker.voiceMissing && h('div', { class: 'notice' }, S.noVoice(c.target)),
    !isStandalone() && h('div', { class: 'info muted' }, S.install),
    h('div', { class: 'label', style: 'margin-top:24px' }, S.courses),
    allCourses().map(o => courseCard(o, o.id === c.id, () => {
      if (o.id !== c.id) { app.tab = 0; app.grammarLevel = null; Store.course = o; render(); }
    })),
    h('button', {
      class: 'text-btn danger', style: 'width:100%;text-align:center', onclick: () => dialog({
        title: S.resetTitle,
        body: h('div', { class: 'body-m muted' }, S.resetText(c.target)),
        actions: close => [
          h('button', { class: 'text-btn', onclick: close }, S.cancel),
          h('button', { class: 'text-btn danger', onclick: () => { close(); Store.reset(c.target); render(); } }, S.reset),
        ],
      }),
    }, S.resetProgress));
}

const stat = (value, label) => h('div', { class: 'stat' }, h('b', {}, value), h('span', { class: 'body-s muted' }, label));

// ---------------------------------------------------------------- Grammatik

/** *betont* und ~~durchgestrichen~~ in formatierten Text umwandeln. */
function markup(t) {
  const out = [];
  const re = /\*([^*]+)\*|~~([^~]+)~~/g;
  let last = 0, m;
  while ((m = re.exec(t))) {
    out.push(t.slice(last, m.index));
    out.push(m[1] ? h('span', { class: 'hl' }, m[1]) : h('span', { class: 'strike' }, m[2]));
    last = m.index + m[0].length;
  }
  out.push(t.slice(last));
  return out;
}

/** Schritte erscheinen nacheinander, einmal automatisch, danach per Knopf. */
function grammarDemo(frames) {
  const list = h('div');
  const replay = h('button', { class: 'icon-btn', style: 'color:var(--primary)', 'aria-label': S.replay, onclick: () => run() }, icon('refresh'));
  const box = h('div', { class: 'demo' },
    h('div', { class: 'row', style: 'gap:6px' },
      h('span', { style: 'color:var(--primary);display:flex' }, icon('play')),
      h('span', { class: 'label grow' }, S.animation), replay),
    list);
  let timer = null;
  function run() {
    clearTimeout(timer);
    list.replaceChildren();
    replay.disabled = true;
    let i = 0;
    const step = () => {
      if (!box.isConnected && i > 0) return;
      list.querySelectorAll('.demo-frame').forEach(f => f.classList.remove('last'));
      list.append(h('div', {}, i > 0 && h('div', { class: 'demo-arrow' }, '↓'), h('div', { class: 'demo-frame last' }, markup(frames[i]))));
      i++;
      if (i < frames.length) timer = setTimeout(step, 1300); else replay.disabled = false;
    };
    timer = setTimeout(step, 300);
  }
  run();
  return box;
}

function ruleTable(rows, speak) {
  return h('div', { class: 'rule-table' }, rows.map(([left, right]) => h('div', { class: 'rule-row' },
    h('div', { class: 'grow' }, h('div', { class: 'title-s' }, left), h('div', { class: 'body-m muted' }, right)),
    speak && audioButton(left, { size: 36 }))));
}

function grammarCard(tip) {
  return h('div', { class: 'grammar' },
    h('h2', { class: 'h2' }, tip.title),
    h('div', { class: 'body-l pre' }, tip.body),
    tip.demo.length > 0 && grammarDemo(tip.demo),
    tip.sections.map(s => [
      h('div', { class: 'label' }, s.heading),
      s.text && h('div', { class: 'body-l pre' }, s.text),
      s.rows.length > 0 && ruleTable(s.rows, s.speak),
    ]),
    h('div', { class: 'label' }, S.examples),
    ruleTable(tip.examples, true));
}

function grammarDetail(c, lesson) {
  const tip = lesson.tips[c.id];
  const level = levelOf(c.target, lesson);
  return h('div', { class: 'screen' },
    h('div', { class: 'back-bar' },
      h('button', { class: 'icon-btn', style: 'color:var(--on-surface)', 'aria-label': 'Zurück', onclick: () => go({ name: 'home' }) }, icon('back')),
      h('span', { class: 'title-m muted ellipsis' }, `${level.name} · ${lesson.title[c.base]}`)),
    h('div', { class: 'step-body', style: 'padding-bottom:calc(24px + env(safe-area-inset-bottom))' }, grammarCard(tip)));
}

// ---------------------------------------------------------------- Übungssitzung

/**
 * Spielt eine Folge von Übungen ab. Fehlerhaft gelöste kommen am Ende noch einmal dran,
 * zählen für die Auswertung aber nur beim ersten Versuch.
 */
function renderSession(root, c) {
  const s = app.screen;
  if (!s.queue) {
    Object.assign(s, { queue: s.steps.slice(), index: 0, firstTry: 0, skipped: 0, results: {}, noAudio: Store.listeningOff });
  }
  const step = s.queue[s.index];
  const view = stepView(step, c, s, outcome => advance(c, s, outcome));
  const bar = h('div', { class: 'bar track' }, h('div', { style: `width:${s.index * 100 / s.queue.length}%` }));
  root.replaceChildren(h('div', { class: 'screen' },
    h('div', { class: 'session-top' },
      h('button', { class: 'icon-btn', 'aria-label': S.quit, onclick: () => confirmQuit() }, icon('close')),
      bar),
    view));
  view.classList.add('enter');
  view.querySelector('[autofocus]')?.focus();
}

function confirmQuit() {
  dialog({
    title: S.quitTitle,
    body: h('div', { class: 'body-m muted' }, S.quitText),
    actions: close => [
      h('button', { class: 'text-btn danger', onclick: () => { close(); go({ name: 'home' }); } }, S.quit),
      h('button', { class: 'text-btn', onclick: close }, S.keepGoing),
    ],
  });
}

function advance(c, s, outcome) {
  const step = s.queue[s.index];
  if (isExercise(step) && s.index < s.steps.length) {
    if (outcome === 'skipped') s.skipped++;
    else {
      const perfect = outcome === 'perfect';
      if (perfect) s.firstTry++;
      s.results[step.item.id] = (s.results[step.item.id] ?? true) && perfect;
      if (!perfect) s.queue.push(app.exercises.again(step));
    }
  }
  Speaker.stop();
  // Ohne Ton keine Sprechübung.
  let next = s.index + 1;
  while (s.noAudio && next < s.queue.length && s.queue[next].type === 'speak') next++;
  if (next >= s.queue.length) finish(c, s);
  else { s.index = next; render(); }
}

function finish(c, s) {
  const graded = s.steps.filter(isExercise).length - s.skipped;
  const result = { graded, firstTry: s.firstTry, items: s.results };
  if (s.kind === 'lesson') {
    Store.completeLesson(c.target, s.lesson);
    go({ name: 'result', kind: s.kind, result, items: itemsOf(s.lesson) });
  } else {
    // Freiwilliges Üben und Training zählen für die Serie, verschieben aber keine Termine.
    Store.completeReview(c.target, s.results, s.kind !== 'review');
    go({ name: 'result', kind: s.kind, result, items: Object.keys(s.results).map(id => index(c.target).items.get(id)).filter(Boolean) });
  }
}

function stepView(step, c, s, done) {
  // Nur die aktuelle Übung darf weiterschalten (doppelte Taps ignorieren).
  let used = false;
  const once = outcome => { if (!used) { used = true; done(outcome); } };
  const finished = mistakes => once(mistakes ? 'mistakes' : 'perfect');
  switch (step.type) {
    case 'intro': return introStep(step, c, finished);
    case 'explain': return frame(S.grammar, [grammarCard(step.tip)], null, bottomButton(S.gotIt, () => finished(false)));
    case 'speak': return speakStep(step, c, finished);
    case 'choice': return choiceStep(step, c, s, finished, () => { s.noAudio = true; Store.pauseListening(); once('skipped'); });
    case 'type': return typeStep(step, c, finished);
    case 'spell': return spellStep(step, c, finished);
    case 'build': return buildStep(step, c, finished);
    case 'gap': return gapStep(step, c, finished);
  }
}

/** Gerüst: Aufgabe oben (scrollbar), Antworten unten im Daumenbereich, darunter Knopf oder Rückmeldung. */
function frame(prompt, content, controls, bottom) {
  const bottomSlot = h('div', {}, bottom || h('div', { class: 'bottom-empty' }));
  const el = h('div', { class: 'step' },
    h('div', { class: 'step-body' }, h('div', { class: 'prompt' }, prompt), content),
    controls && h('div', { class: 'controls' }, controls),
    bottomSlot);
  el.setBottom = node => bottomSlot.replaceChildren(node);
  return el;
}

const bottomButton = (label, onclick, disabled) =>
  h('div', { class: 'bottom' }, h('button', { class: 'btn', onclick, disabled }, label));

function feedbackBar(perfect, title, solution, translation, onNext) {
  return h('div', { class: 'feedback' + (perfect ? ' ok' : '') },
    h('div', { class: 'fb-title' }, title),
    h('div', { class: 'title-m' }, solution),
    h('div', { class: 'body-m muted' }, translation),
    h('button', { class: 'btn' + (perfect ? ' green' : ''), onclick: onNext }, S.next));
}

function introStep(step, c, finished) {
  const t = text(step.item, c.target);
  Speaker.speak(t);
  return frame(step.sentence ? S.newSentence : S.newWord, [
    h('div', { class: 'card intro' },
      audioButton(t, { size: 72, autoPlay: true }),
      h('div', { class: step.sentence ? 'h2' : 'display' }, t),
      h('div', { class: 'title-m muted' }, text(step.item, c.base))),
    h('div', { class: 'body-s muted center' }, S.tapAgainSlow),
  ], null, bottomButton(S.next, () => finished(false)));
}

function choiceStep(step, c, s, finished, cantListen) {
  const spoken = text(step.item, c.target);
  // Ohne Ton wird aus "Was hörst du?" ein "Wie sagt man das?" mit der Bedeutung als Vorgabe.
  const mode = s.noAudio && step.mode === 'Listening' ? 'Reverse' : step.mode;
  const prompt = mode === 'Reverse' && step.mode === 'Listening' ? text(step.item, c.base) : step.prompt;
  const wrong = new Set();
  let solved = false;
  const cards = step.options.map(option => {
    const btn = h('button', {
      class: 'option', onclick: () => {
        if (solved || wrong.has(option)) return;
        if (option === step.answer) {
          solved = true;
          btn.classList.add('correct');
          cards.forEach(b => { b.disabled = true; });
          if (cantBtn) cantBtn.disabled = true;
          if (mode !== 'Meaning' && !s.noAudio) Speaker.speak(spoken);
          setTimeout(() => finished(wrong.size > 0), mode === 'Meaning' || s.noAudio ? 700 : 1100);
        } else {
          wrong.add(option);
          btn.classList.add('wrong');
          btn.disabled = true;
          vibrate();
        }
      },
    }, option);
    return btn;
  });
  const cantBtn = mode === 'Listening' ? h('button', { class: 'text-btn', style: 'align-self:center', onclick: cantListen }, S.cantListen) : null;
  let top;
  if (mode === 'Meaning') {
    if (!s.noAudio) Speaker.speak(spoken);
    top = h('div', { class: 'prompt-box' }, !s.noAudio && audioButton(spoken, { autoPlay: true }), h('div', { class: 'h1' }, prompt));
  } else if (mode === 'Reverse') {
    top = h('div', { class: 'prompt-box' }, h('div', { class: 'h1' }, prompt));
  } else {
    Speaker.speak(spoken);
    top = h('div', { class: 'prompt-box' }, audioButton(spoken, { size: 104, autoPlay: true }));
  }
  const promptText = { Meaning: S.promptMeaning, Reverse: S.promptReverse(c.target), Listening: S.promptListening }[mode];
  return frame(promptText, [top], [cards, cantBtn], null);
}

/** Vergleichsform: ohne Groß/Klein, Satzzeichen und doppelte Leerzeichen. */
const normalize = t => tokens(t.toLowerCase().replace(/’/g, "'")).join(' ');
const stripAccents = t => t.normalize('NFD').replace(/\p{M}/gu, '').replace(/œ/g, 'oe').replace(/ß/g, 'ss');

function typeStep(step, c, finished) {
  let checked = false;
  const input = h('input', {
    class: 'text-field', type: 'text', placeholder: S.typeHere, autofocus: true,
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'done',
    lang: LANGS[c.target].speech,
    oninput: () => { btn.disabled = !input.value.trim(); },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); check(); } },
  });
  const btn = h('button', { class: 'btn', disabled: true, onclick: () => check() }, S.check);
  const el = frame(S.promptType(c.target), [h('div', { class: 'h1' }, step.prompt), input], null, h('div', { class: 'bottom' }, btn));
  function check() {
    if (checked || !input.value.trim()) return;
    const want = normalize(step.answer), got = normalize(input.value);
    const correct = got === want || stripAccents(got) === stripAccents(want);
    const accentsOff = correct && got !== want;
    checked = true;
    input.readOnly = true;
    Speaker.speak(step.answer);
    input.blur();
    el.setBottom(feedbackBar(correct, accentsOff ? S.accentHint : correct ? S.correct : S.correctAnswerIs,
      step.answer, step.prompt, () => finished(!correct)));
  }
  return el;
}

/**
 * Kachel-Übungen: Kacheln in der richtigen Reihenfolge antippen; eine falsche leuchtet kurz rot
 * und zählt als Fehler. onPlaced zeichnet die Antwortzeile neu.
 */
function tileStep({ prompt, tiles, target, spoken, translation, header, onPlaced, finished }) {
  let placed = 0, mistakes = false;
  const el = frame(prompt, header, h('div', { class: 'tiles' }, tiles.map(t => {
    const tile = h('button', {
      class: 'tile', onclick: () => {
        if (placed >= target.length || tile.disabled) return;
        if (t.toLowerCase() === target[placed].toLowerCase()) {
          tile.disabled = true;
          tile.classList.add('used');
          placed++;
          onPlaced(placed);
          if (placed === target.length) {
            Speaker.speak(spoken);
            el.setBottom(feedbackBar(!mistakes, mistakes ? S.withMistakes : S.correct, spoken, translation, () => finished(mistakes)));
          }
        } else {
          mistakes = true;
          tile.classList.add('flash');
          vibrate();
          setTimeout(() => tile.classList.remove('flash'), 450);
        }
      },
    }, t);
    return tile;
  })), null);
  return el;
}

const tileChar = ch => ch === ' ' ? '␣' : ch;

function spellStep(step, c, finished) {
  // Leerzeichen als sichtbare Kachel, damit Ausdrücke wie "le week-end" gehen.
  const letters = Array.from(step.word).map(tileChar);
  const line = h('div', { class: 'answer-line letters' });
  const draw = n => line.replaceChildren(...letters.map((ch, i) => h('span', {}, i < n ? ch : ' ')));
  draw(0);
  return tileStep({
    prompt: S.promptSpell(c.target), tiles: step.letters.map(tileChar), target: letters, spoken: step.word,
    translation: text(step.item, c.base), onPlaced: draw, finished,
    header: [h('div', { class: 'row', style: 'gap:16px' }, audioButton(step.word), h('div', { class: 'h1' }, text(step.item, c.base))), line],
  });
}

function buildStep(step, c, finished) {
  const line = h('div', { class: 'answer-line' });
  const draw = n => line.replaceChildren(...step.target.slice(0, n).map(w => h('span', {}, w)));
  return tileStep({
    prompt: S.promptBuild(c.target), tiles: step.tiles, target: step.target, spoken: step.sentence,
    translation: text(step.item, c.base), onPlaced: draw, finished,
    header: [h('div', { class: 'h2' }, text(step.item, c.base)), line],
  });
}

function gapStep(step, c, finished) {
  const sentence = h('div', { class: 'h2' }, step.gapped);
  return tileStep({
    prompt: S.promptGap, tiles: step.options, target: [step.answer], spoken: step.sentence,
    translation: text(step.item, c.base), onPlaced: () => { sentence.textContent = step.sentence; }, finished,
    header: [h('div', { class: 'card pad stack-s' }, sentence, h('div', { class: 'body-l muted' }, text(step.item, c.base)))],
  });
}

/** Anteil der Zielwörter, die in der Erkennung vorkommen (0..1). */
function spokenScore(target, heard) {
  const norm = t => tokens(t.toLowerCase().replace(/’/g, "'").replace(/-/g, ' '));
  const want = norm(target), got = new Set(norm(heard));
  return want.length ? want.filter(w => got.has(w)).length / want.length : 0;
}

function speakStep(step, c, finished) {
  Speaker.speak(step.text);
  const status = h('div', { class: 'center-col', style: 'gap:8px' }, h('div', { class: 'body-l muted' }, S.tapToSpeak));
  let rec = null;
  const mic = h('button', {
    class: 'mic', 'aria-label': S.tapToSpeak, onclick: () => {
      if (rec) { rec.stop(); return; }
      Speaker.stop();
      try {
        rec = new Recognition();
        rec.lang = LANGS[c.target].speech;
        rec.maxAlternatives = 5;
        rec.interimResults = false;
        rec.onresult = e => {
          const options = Array.from(e.results[0] || []).map(a => a.transcript);
          if (!options.length) return;
          const best = options.reduce((a, b) => spokenScore(step.text, b) > spokenScore(step.text, a) ? b : a);
          const good = spokenScore(step.text, best) >= 0.75;
          status.replaceChildren(
            h('div', { class: 'title-l', style: `color:var(${good ? '--tertiary' : '--primary'})` }, good ? S.spokenWell : S.spokenAlmost),
            h('div', { class: 'body-l muted' }, S.youSaid(best)));
          el.setBottom(bottomButton(S.next, () => finished(false)));
        };
        rec.onerror = e => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
            status.replaceChildren(h('div', { class: 'body-m muted' }, S.noMic));
          }
        };
        rec.onend = () => { rec = null; mic.classList.remove('listening'); };
        rec.start();
        mic.classList.add('listening');
        status.replaceChildren(h('div', { class: 'body-l muted' }, S.listening));
      } catch (err) {
        rec = null;
        status.replaceChildren(h('div', { class: 'body-m muted' }, S.noMic));
      }
    },
  }, icon('mic'));
  const el = frame(S.promptSpeak, [
    h('div', { class: 'card pad row', style: 'gap:16px' },
      audioButton(step.text, { autoPlay: true }),
      h('div', { class: 'grow' }, h('div', { class: 'h2' }, step.text), h('div', { class: 'body-m muted' }, text(step.item, c.base)))),
  ], [h('div', { class: 'center-col', style: 'gap:16px' }, status, mic)],
  h('div', { class: 'bottom center-col' }, h('button', { class: 'text-btn', onclick: () => { rec?.abort(); finished(false); } }, S.cantSpeak)));
  return el;
}

// ---------------------------------------------------------------- Ergebnis

function resultScreen(c, s, p) {
  const title = s.kind === 'lesson' ? S.lessonDone : s.kind === 'training' ? S.trainingDone : S.reviewDone;
  const r = s.result;
  const percent = r.graded === 0 ? 100 : Math.floor(r.firstTry * 100 / r.graded);
  return h('div', { class: 'screen' },
    h('div', { class: 'scroll stack' },
      h('div', { class: 'result-check' }, icon('check')),
      h('h1', { class: 'h1 center' }, title),
      h('div', { class: 'stats' }, stat(`${percent} %`, S.accuracy), stat(p.streak, S.streak)),
      s.items.length > 0 && [
        h('div', { class: 'label', style: 'margin-top:24px' }, s.kind === 'lesson' ? S.newVocabulary : S.reviewedItems),
        h('div', { class: 'card-m', style: 'margin-top:8px' }, s.items.map(item => h('div', { class: 'item-row' },
          h('div', { class: 'grow' }, h('div', { class: 'title-s' }, text(item, c.target)), h('div', { class: 'body-s muted' }, text(item, c.base))),
          h('span', { class: 'small-dot' + (r.items[item.id] === false ? ' miss' : '') })))),
      ]),
    bottomButton(S.next, () => go({ name: 'home' })));
}

// ---------------------------------------------------------------- Start

async function start() {
  try {
    const res = await fetch('content.json');
    CONTENT = await res.json();
  } catch (e) {
    document.getElementById('app').replaceChildren(h('div', { class: 'loading', style: 'font-size:16px;padding:24px;text-align:center' },
      'Inhalte konnten nicht geladen werden. Bitte mit Internet neu öffnen.'));
    return;
  }
  Store.load();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
