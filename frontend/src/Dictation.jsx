import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

/**
 * Dictation using the browser's built-in speech recognition (Chrome, Edge,
 * Safari). Audio is processed by the browser vendor's service — Google for
 * Chrome, Microsoft for Edge — so firms can switch it off in Settings.
 */

// Firm-level on/off (Settings → Dictation). Provided by App.
export const DictationContext = createContext(true);

const Recognition = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const dictationSupported = !!Recognition;

// Only one microphone at a time across the page.
let stopActive = null;

// Spoken punctuation → symbols. Longer phrases first.
const COMMANDS = [
  [/\bnew paragraph\b/gi, "\n\n"],
  [/\bnew line\b/gi, "\n"],
  [/\b(full stop|period)\b/gi, "."],
  [/\bquestion mark\b/gi, "?"],
  [/\bexclamation mark\b/gi, "!"],
  [/\bsemicolon\b/gi, ";"],
  [/\bcolon\b/gi, ":"],
  [/\bcomma\b/gi, ","],
  [/\bopen bracket\b/gi, "("],
  [/\bclose bracket\b/gi, ")"],
];

/** Turns a chunk of recognised speech into text to append after `before`. */
export function formatDictation(before, spoken) {
  let text = spoken.trim();
  for (const [pattern, symbol] of COMMANDS) text = text.replace(pattern, symbol);
  text = text
    .replace(/\s+([.,?!;:)])/g, "$1")      // no space before punctuation
    .replace(/\(\s+/g, "(")
    .replace(/[ \t]*\n[ \t]*/g, "\n")      // tidy around line breaks
    .replace(/([.,?!;:])(?=[^\s\n.,?!;:)])/g, "$1 "); // space after punctuation
  if (!text) return "";

  const startsSentence = !before.trim() || /[.?!]\s*$/.test(before) || /\n\s*$/.test(before);
  text = text.replace(/(^|[.?!]\s+|\n)([a-z])/g, (m, lead, ch) => lead + ch.toUpperCase());
  if (startsSentence) text = text.charAt(0).toUpperCase() + text.slice(1);
  // Mid-sentence: undo the engine's habit of capitalising each phrase — but
  // leave "I", acronyms (FENSA) and anything else that isn't Capitalised-lowercase.
  else if (/^[A-Z][a-z]/.test(text) && !/^I\b/.test(text)) text = text.charAt(0).toLowerCase() + text.slice(1);

  const needsSpace = before && !/\s$/.test(before) && !/^[.,?!;:)\n]/.test(text);
  return (needsSpace ? " " : "") + text;
}

/**
 * A <textarea> with a microphone button. Drop-in replacement: takes the same
 * props (value / onChange / onBlur …). Dictated text is appended through the
 * textarea's own onChange, so any form using it needs no other changes.
 */
export function DictTextarea({ style, ...props }) {
  const enabled = useContext(DictationContext);
  const ref = useRef(null);
  const latest = useRef(props);
  latest.current = props;
  const recognition = useRef(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => recognition.current?.abort(), []);

  function stop() {
    recognition.current?.stop();
  }

  function start() {
    if (stopActive) stopActive();
    setError("");
    const r = new Recognition();
    r.lang = "en-GB";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const current = String(latest.current.value ?? "");
          const addition = formatDictation(current, result[0].transcript);
          if (addition) latest.current.onChange?.({ target: { value: current + addition } });
        } else {
          pending += result[0].transcript;
        }
      }
      setInterim(pending);
    };
    r.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access is blocked — allow it in your browser's address bar, then try again.");
      } else if (event.error === "no-speech") {
        setError("Didn't catch anything — try again a little closer to the microphone.");
      } else if (event.error !== "aborted") {
        setError("Dictation stopped unexpectedly. Please try again.");
      }
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
      if (stopActive === stop) stopActive = null;
      // Put the cursor back so fields that save on blur (e.g. file notes) save the dictated text.
      ref.current?.focus();
    };
    recognition.current = r;
    stopActive = stop;
    r.start();
    setListening(true);
  }

  const showMic = enabled && dictationSupported;

  return (
    <div className="ac-dict">
      <textarea ref={ref} {...props} style={{ ...style, ...(showMic ? { paddingRight: 40 } : {}) }} />
      {showMic && (
        <button
          type="button"
          className={`ac-dict-btn ${listening ? "on" : ""}`}
          onClick={() => (listening ? stop() : start())}
          title={listening ? "Stop dictation" : "Dictate (say “full stop”, “comma”, “new paragraph”)"}
          aria-label={listening ? "Stop dictation" : "Start dictation"}
        >
          {listening ? <Square size={13} /> : <Mic size={15} />}
        </button>
      )}
      {listening && (
        <div className="ac-dict-hint">
          <span className="dot" /> Listening{interim ? <>: <em>{interim}</em></> : " — say “full stop”, “comma” or “new paragraph” for punctuation"}
        </div>
      )}
      {error && !listening && <div className="ac-dict-hint error">{error}</div>}
    </div>
  );
}
