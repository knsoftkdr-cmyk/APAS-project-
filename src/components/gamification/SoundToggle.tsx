import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Volume2, VolumeX, Music, Music2 } from "lucide-react";
import {
  getSoundSettings, subscribeSound, setSfxEnabled, setMusicEnabled, setSoundVolume, resumeAudio, playClickSound,
} from "./sounds";

/**
 * Floating sound control for the Gamification page.
 * One tap mutes / unmutes effects. The small panel adds background music and volume.
 * Also unlocks the browser's audio on the first tap anywhere (browsers block sound before that).
 */
export function SoundToggle() {
  const s = useSyncExternalStore(subscribeSound, getSoundSettings, getSoundSettings);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlock = () => resumeAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const btn = "h-11 w-11 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95";
  return (
    <div ref={box} className="fixed bottom-4 start-4 z-50 flex flex-col items-start gap-2">
      {open && (
        <div role="group" aria-label="Sound settings" className="p-3 rounded-2xl w-56 space-y-3"
          style={{ background: "#FFFDF5", border: "3px solid #24135F", boxShadow: "0 4px 0 #24135F", color: "#24135F" }}>
          <label className="flex items-center justify-between text-sm font-bold">
            Sound effects
            <input type="checkbox" checked={s.sfx} onChange={(e) => setSfxEnabled(e.target.checked)} className="h-5 w-5 accent-[#FF5E73]" />
          </label>
          <label className="flex items-center justify-between text-sm font-bold">
            Music
            <input type="checkbox" checked={s.music} onChange={(e) => setMusicEnabled(e.target.checked)} className="h-5 w-5 accent-[#FF5E73]" />
          </label>
          <label className="block text-sm font-bold">
            Volume
            <input type="range" min={0} max={1} step={0.05} value={s.volume} aria-label="Volume"
              onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
              onPointerUp={playClickSound} className="w-full mt-1 accent-[#FF5E73]" />
          </label>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className={btn} aria-label={s.sfx ? "Mute sound effects" : "Turn on sound effects"} aria-pressed={s.sfx}
          onClick={() => setSfxEnabled(!s.sfx)}
          style={{ background: s.sfx ? "#FFB830" : "#FFFDF5", border: "3px solid #24135F", boxShadow: "0 3px 0 #24135F", color: "#24135F" }}>
          {s.sfx ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
        </button>
        <button type="button" className={btn} aria-label="Sound settings" aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{ background: s.music ? "#7CE0B8" : "#FFFDF5", border: "3px solid #24135F", boxShadow: "0 3px 0 #24135F", color: "#24135F" }}>
          {s.music ? <Music className="h-5 w-5" /> : <Music2 className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
