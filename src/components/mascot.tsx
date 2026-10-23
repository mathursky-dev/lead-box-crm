"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// "Boxy" — a small brand mascot that keeps the day light. Purely cosmetic: no data, no network.
const LINES = [
  "Ek aur follow-up = ek aur chance. Chalo! 💪",
  "Paani piya? 💧 Hydrated agent = happy agent.",
  "2 minute stretch break? Gardan ghumao, shoulders relax 🙆",
  "Tip: customer ka naam lekar reply karo — reply rate badhta hai ✨",
  "Mujhe bhi ek lead chahiye… par main toh box hoon 📦😅",
  "Overdue follow-ups pehle, phir nayi leads. Smart move! 🧠",
  "Aaj ka mantra: Simplify Sales, Accelerate Growth 🚀",
  "Smile karke call karo — customer ko awaaz me sunai deta hai 😊",
  "Joke: Lead ne 'seen' kiya, reply nahi… classic! 🙈",
  "Tip: 24 ghante ki window me reply karo, warna template lagega ⏰",
  "Har 'No' aapko agle 'Yes' ke kareeb le jaata hai 🙌",
  "Thoda chai break? ☕ Main yahin wait karunga.",
  "Aap great kaam kar rahe ho. Seriously! 🌟",
  "Tip: hot leads ko aaj hi call karo — kal thandi ho sakti hain 🔥",
];
const PET = ["Hehe, gudgudi hoti hai! 😆", "Yay! Ek aur pat! 💚", "Main ready hoon, aap ready ho? 🤖", "Boop! 👉📦"];

function greeting(name: string) {
  const h = new Date().getHours();
  const first = name.split(" ")[0] || "dost";
  if (h < 12) return `Good morning, ${first}! ☀️ Aaj ka din productive banate hain.`;
  if (h < 17) return `Hi ${first}! 👋 Afternoon energy low? Main hoon na!`;
  return `Good evening, ${first}! 🌙 Aaj ke kaam almost done?`;
}
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };

export function Mascot({ name }: { name: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [mood, setMood] = useState<"idle" | "jump" | "dance">("idle");
  const [hearts, setHearts] = useState<number[]>([]);
  const taps = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, ms = 7000) => {
    setMsg(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), ms);
  }, []);

  useEffect(() => {
    const t0 = setTimeout(() => {
      setHidden(store.get("lb-mascot-hidden") === "1");
      if (store.get("lb-mascot-hidden") !== "1") say(greeting(name), 8000);
    }, 1500);
    const iv = setInterval(() => { if (store.get("lb-mascot-hidden") !== "1" && document.visibilityState === "visible") say(pick(LINES)); }, 120000);
    return () => { clearTimeout(t0); clearInterval(iv); if (timer.current) clearTimeout(timer.current); };
  }, [name, say]);

  const tap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2500), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      setMood("dance"); say("Dance break! 🕺💃 Ab wapas kaam pe 😄", 4000);
      setTimeout(() => setMood("idle"), 2400);
      return;
    }
    setMood("jump"); setTimeout(() => setMood("idle"), 600);
    setHearts((h) => [...h, now]); setTimeout(() => setHearts((h) => h.filter((x) => x !== now)), 1200);
    say(Math.random() < 0.5 ? pick(PET) : pick(LINES), 5000);
  };
  const toggle = (v: boolean) => { setHidden(v); store.set("lb-mascot-hidden", v ? "1" : "0"); if (!v) say("Main wapas aa gaya! 🎉", 4000); };

  if (hidden) return (
    <button onClick={() => toggle(false)} aria-label="Show Boxy"
      className="fixed bottom-0 right-6 z-30 translate-y-6 rounded-t-xl bg-[#047782] px-3 pb-7 pt-1.5 text-white shadow-lg transition hover:translate-y-4">
      <span className="flex gap-1.5"><i className="lb-eye block h-2 w-2 rounded-full bg-white" /><i className="lb-eye block h-2 w-2 rounded-full bg-white" /></span>
    </button>
  );

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-30 flex flex-col items-end gap-2 max-md:bottom-3 max-md:right-3">
      {msg && (
        <div role="status" className="lb-bubble pointer-events-auto relative max-w-[240px] rounded-2xl rounded-br-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-lg">
          {msg}
          <button className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-slate-200 text-[10px] text-slate-600 hover:bg-slate-300" onClick={() => setMsg(null)} aria-label="Close message">✕</button>
        </div>
      )}
      <div className="group pointer-events-auto relative">
        {hearts.map((h) => <span key={h} className="lb-heart pointer-events-none absolute left-1/2 top-0 text-lg">💚</span>)}
        <button onClick={tap} aria-label="Boxy, your CRM buddy — tap me" className={`lb-bot block ${mood === "jump" ? "lb-jump" : mood === "dance" ? "lb-dance" : ""}`}>
          <svg width="64" height="72" viewBox="0 0 64 72" aria-hidden>
            <g className="lb-antenna"><line x1="32" y1="14" x2="32" y2="5" stroke="#0f294e" strokeWidth="2.5" strokeLinecap="round" /><circle className="lb-bulb" cx="32" cy="5" r="4" fill="#b3582a" /></g>
            <g className="lb-arm-l"><rect x="2" y="34" width="8" height="16" rx="4" fill="#0f294e" /></g>
            <g className="lb-arm-r"><rect x="54" y="34" width="8" height="16" rx="4" fill="#0f294e" /></g>
            <rect x="8" y="14" width="48" height="44" rx="12" fill="#047782" />
            <rect x="14" y="20" width="36" height="24" rx="8" fill="#0f294e" />
            <g className="lb-eyes"><ellipse cx="25" cy="31" rx="3.5" ry="4.5" fill="#fff" /><ellipse cx="39" cy="31" rx="3.5" ry="4.5" fill="#fff" /></g>
            <path d="M27 38 Q32 42 37 38" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
            <circle cx="18" cy="38" r="2.5" fill="#f9a8a8" opacity=".7" /><circle cx="46" cy="38" r="2.5" fill="#f9a8a8" opacity=".7" />
            <rect x="20" y="49" width="24" height="4" rx="2" fill="#0f294e" opacity=".35" />
            <rect x="18" y="58" width="9" height="10" rx="3" fill="#0f294e" /><rect x="37" y="58" width="9" height="10" rx="3" fill="#0f294e" />
          </svg>
        </button>
        <button onClick={() => toggle(true)} aria-label="Hide Boxy"
          className="absolute -left-2 -top-1 hidden h-5 w-5 rounded-full bg-slate-700 text-[10px] text-white group-hover:block group-focus-within:block">–</button>
      </div>
    </div>
  );
}
