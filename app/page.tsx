"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import FAQ from "./components/FAQ";
import CodeBlock from "./components/CodeBlock";

const BrainBird = dynamic(() => import("./components/BrainBird"), { ssr: false });

const ESP32_CODE = `/*
 * EMG BLE Spacebar — AD8232 + ESP32
 * Detects forearm muscle contraction and presses/holds spacebar over BLE.
 *
 * ═══════════════════════════════════════════════════════════
 * REQUIRED LIBRARY
 * ═══════════════════════════════════════════════════════════
 * Install "ESP32 BLE Keyboard" by T-vK via Arduino Library Manager,
 * or: https://github.com/T-vK/ESP32-BLE-Keyboard
 *
 * ═══════════════════════════════════════════════════════════
 * AD8232 WIRING  (AD8232 pin → ESP32 pin)
 * ═══════════════════════════════════════════════════════════
 *   3.3V   → 3.3V
 *   GND    → GND
 *   OUTPUT → GPIO 35  (ADC-only input, no internal pull-up needed)
 *   LO+    → GPIO 25  (lead-off detection, active HIGH when electrode off)
 *   LO-    → GPIO 26  (lead-off detection, active HIGH when electrode off)
 *   SDN    → 3.3V     (tie HIGH to keep chip enabled; LOW = shutdown)
 *
 * ═══════════════════════════════════════════════════════════
 * LED WIRING  (anode → GPIO, cathode → 220Ω resistor → GND)
 * ═══════════════════════════════════════════════════════════
 *   Green LED → GPIO 27  (squeeze / spacebar active)
 *   Red LED   → GPIO 14  (idle, leads-off, or BLE disconnected)
 *
 * ═══════════════════════════════════════════════════════════
 * TARE BUTTON
 * ═══════════════════════════════════════════════════════════
 *   One leg → GPIO 13
 *   Other leg → GND
 *   (internal pull-up is enabled in code — no external resistor needed)
 *
 * ═══════════════════════════════════════════════════════════
 * ELECTRODE PLACEMENT  (forearm squeeze / stress ball)
 * ═══════════════════════════════════════════════════════════
 * Sit with the squeezing arm relaxed, palm facing UP.
 * You are targeting the flexor digitorum superficialis — the big
 * muscle group on the inner forearm that fires when you grip.
 *
 *   RED electrode   (RA / IN+):
 *       Inner forearm, ~2 inches (5 cm) below the crease of the elbow,
 *       centered on the muscle belly. This is the "active" lead.
 *
 *   YELLOW electrode (LA / IN−):
 *       Inner forearm, ~4 inches (10 cm) below the elbow crease —
 *       roughly 2 inches distal from the RED electrode, same muscle belly.
 *       Differential pair: keep both on the same muscle, along its length.
 *
 *   GREEN electrode  (RL / reference / right-leg drive):
 *       Bony area where there is minimal muscle — good options:
 *         • Back of the wrist (dorsal side)
 *         • Lateral elbow (olecranon)
 *       This is the noise-rejection reference; placement is flexible.
 *
 * Electrode tips:
 *   - Clean skin with alcohol wipe and let dry before applying.
 *   - Press firmly; loose contact causes noise and false triggers.
 *   - Keep RED and YELLOW parallel to the muscle fiber direction.
 *
 * ═══════════════════════════════════════════════════════════
 * TUNING
 * ═══════════════════════════════════════════════════════════
 * Open Serial Monitor at 115200 baud. Watch the "envelope" value:
 *   - At rest it should hover near 0.
 *   - On a firm squeeze it should spike to 200–800+ (ADC units).
 * Adjust SQUEEZE_THRESHOLD so it sits comfortably above the resting
 * noise floor but below a light squeeze. Start at 150 and tune up/down.
 *
 * If the signal is noisy at rest, increase ENVELOPE_ALPHA slightly
 * (more smoothing) or lower it for faster response.
 */

#include <Arduino.h>
#include <HijelHID_BLEKeyboard.h>

// ── Pin definitions ────────────────────────────────────────────────────────────
static constexpr uint8_t PIN_EMG          = 35;  // AD8232 OUTPUT → ADC
static constexpr uint8_t PIN_LEAD_OFF_POS = 25;  // AD8232 LO+
static constexpr uint8_t PIN_LEAD_OFF_NEG = 26;  // AD8232 LO-
static constexpr uint8_t PIN_LED_GREEN    = 27;  // Squeeze indicator
static constexpr uint8_t PIN_LED_RED      = 14;  // Idle / error indicator
static constexpr uint8_t PIN_TARE_BTN     = 13;  // Active-low tare button

// ── Tunable parameters ─────────────────────────────────────────────────────────
static constexpr uint32_t SAMPLE_INTERVAL_US = 1000;   // 1 kHz
static constexpr float    ENVELOPE_ALPHA     = 0.05f;  // EMA smoothing [0–1]; lower = smoother
static constexpr uint16_t TARE_SAMPLES       = 500;    // Samples averaged during tare (~0.5 s)
static constexpr float    SQUEEZE_THRESHOLD  = 400.0f; // Envelope units above baseline → squeeze
static constexpr uint32_t DEBOUNCE_MS        = 50;     // Minimum dwell in each state (ms)

// ── Globals ────────────────────────────────────────────────────────────────────
HijelHID_BLEKeyboard keyboard;

float    baseline          = 2048.0f; // Default ADC mid-rail for 3.3 V supply
float    envelope          = 0.0f;
bool     squeezing         = false;
uint32_t lastStateChangeMs = 0;

// ── Forward declarations ───────────────────────────────────────────────────────
void performTare();
void setLEDs(bool green, bool red);
bool leadsOff();

// ── Helpers ────────────────────────────────────────────────────────────────────

bool leadsOff() {
  // LO+ or LO- goes HIGH when an electrode is not making good contact.
  return digitalRead(PIN_LEAD_OFF_POS) || digitalRead(PIN_LEAD_OFF_NEG);
}

void setLEDs(bool green, bool red) {
  digitalWrite(PIN_LED_GREEN, green ? HIGH : LOW);
  digitalWrite(PIN_LED_RED,   red   ? HIGH : LOW);
}

// Sample TARE_SAMPLES readings at rest to establish the DC baseline.
// Both LEDs light during the process, then turn off briefly as confirmation.
void performTare() {
  setLEDs(true, true);
  Serial.println("[TARE] Sampling baseline — hold still...");

  long sum = 0;
  for (uint16_t i = 0; i < TARE_SAMPLES; i++) {
    sum += analogRead(PIN_EMG);
    delayMicroseconds(SAMPLE_INTERVAL_US);
  }
  baseline = static_cast<float>(sum) / TARE_SAMPLES;
  envelope = 0.0f;

  Serial.printf("[TARE] Done. Baseline = %.1f\\n", baseline);
  setLEDs(false, false);
  delay(200); // brief off to signal completion
}

// ── Setup ──────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  pinMode(PIN_LEAD_OFF_POS, INPUT);
  pinMode(PIN_LEAD_OFF_NEG, INPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED,   OUTPUT);
  pinMode(PIN_TARE_BTN,  INPUT_PULLUP);

  analogReadResolution(12); // 12-bit ADC: values 0–4095

  keyboard.begin();

  // Red on while waiting for BLE host to connect
  setLEDs(false, true);
  Serial.println("[BLE] Advertising as \\"HijelHID KB\\" — connect from your device.");
}

// ── Main loop ──────────────────────────────────────────────────────────────────
void loop() {
  static uint32_t lastSampleUs = 0;
  static uint32_t lastPrintMs  = 0;

  // ── Tare button (active-low, held for at least 30 ms) ──────────────────────
  if (digitalRead(PIN_TARE_BTN) == LOW) {
    delay(30);
    if (digitalRead(PIN_TARE_BTN) == LOW) {
      performTare();
      while (digitalRead(PIN_TARE_BTN) == LOW); // wait for release
    }
  }

  // ── Rate-limit to SAMPLE_INTERVAL_US ───────────────────────────────────────
  uint32_t nowUs = micros();
  if (nowUs - lastSampleUs < SAMPLE_INTERVAL_US) return;
  lastSampleUs = nowUs;

  // ── Lead-off detection ─────────────────────────────────────────────────────
  if (leadsOff()) {
    if (squeezing && keyboard.isPaired()) {
      keyboard.releaseAll();
    }
    squeezing = false;
    setLEDs(false, true); // red: electrodes off
    return;
  }

  // ── EMG envelope detection ─────────────────────────────────────────────────
  static float sample = 2048.0f;
  sample = static_cast<float>(analogRead(PIN_EMG));
  float deviation = fabsf(sample - baseline);

  // Exponential moving average — builds a smooth amplitude envelope
  envelope = ENVELOPE_ALPHA * deviation + (1.0f - ENVELOPE_ALPHA) * envelope;

  // ── State machine with debounce ────────────────────────────────────────────
  bool     squeezingNow = (envelope > SQUEEZE_THRESHOLD);
  uint32_t nowMs        = millis();

  if (squeezingNow != squeezing && (nowMs - lastStateChangeMs) > DEBOUNCE_MS) {
    squeezing         = squeezingNow;
    lastStateChangeMs = nowMs;

    if (keyboard.isPaired()) {
      if (squeezing) {
        keyboard.press(KEY_SPACE);   // hold spacebar
      } else {
        keyboard.releaseAll();       // release spacebar
      }
    }
  }

  // Green = squeezing, Red = idle (only when BLE is connected and leads on)
  if (keyboard.isPaired()) {
    setLEDs(squeezing, !squeezing);
  } else {
    // Slowly blink red while waiting for BLE connection
    bool blink = ((nowMs / 500) % 2 == 0);
    setLEDs(false, blink);
  }

  // ── Serial debug ~10 Hz ────────────────────────────────────────────────────
  if (nowMs - lastPrintMs > 100) {
    lastPrintMs = nowMs;
    Serial.printf(">baseline:%.0f\\n>sample:%.0f\\n>envelope:%.1f\\n>threshold:%.0f\\n>squeeze:%d\\n",
                  baseline, sample, envelope, baseline + SQUEEZE_THRESHOLD, (int)squeezing);
  }
}`;

const MATERIALS = [
  {
    name: "ESP32 Dev Board",
    desc: "Dual-core 240 MHz, Wi-Fi + Bluetooth 5.0, 12-bit ADC — the brains of the build",
    price: "~$10",
    link: "https://www.amazon.com/Development-AYWHP-ESP-WROOM-32-Bluetooth-Compatible/dp/B0DG8JFY3C",
    color: "#4A90E2",
  },
  {
    name: "Breadboard + Jumper Wires",
    desc: "830-point breadboard with assorted male-to-male jumper wires for prototyping",
    price: "~$8",
    link: "https://www.amazon.com/HUAREW-Breadboard-Jumper-Include-Points/dp/B09VKYLYN7",
    color: "#34d399",
  },
  {
    name: "USB-C to USB-C Cable",
    desc: "Amazon Basics certified cable — for programming and powering the ESP32",
    price: "~$8",
    link: "https://www.amazon.com/Amazon-Basics-Charger-480Mbps-Certified/dp/B01GGKYZQM",
    color: "#a78bfa",
  },
  {
    name: "AD8232 EMG/ECG Sensor",
    desc: "Instrumentation amp module with 3 electrode leads — measures muscle signals",
    price: "~$10",
    link: "https://www.aliexpress.us/item/3256810304860653.html",
    color: "#FFB7C5",
  },
];

// Deterministic dot positions (avoids SSR hydration mismatch from Math.random)
function seededRng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}
const NEURON_DOTS = Array.from({ length: 20 }, (_, i) => {
  const r = seededRng(i * 7919 + 42);
  return {
    size: Math.round(r() * 4 + 1),
    left: Math.round(r() * 100),
    top: Math.round(r() * 100),
    pink: i % 3 === 0,
    opacity: Math.round((0.3 + r() * 0.4) * 100) / 100,
  };
});

type Tab = "game" | "video" | "faq" | "build";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "game", label: "Brain-Bird", icon: "🧠" },
  { id: "faq", label: "FAQ", icon: "?" },
  { id: "build", label: "Build Guide", icon: "⚙" },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("game");

  return (
    <div className="min-h-screen" style={{ background: "var(--cream)" }}>
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <header
        className="relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #1a1a2e 0%, #0f3460 60%, #16213e 100%)",
        }}
      >
        {/* Background neural net decoration — deterministic positions */}
        <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
          {NEURON_DOTS.map((dot, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: dot.size,
                height: dot.size,
                left: `${dot.left}%`,
                top: `${dot.top}%`,
                background: dot.pink ? "#FFB7C5" : "#4A90E2",
                opacity: dot.opacity,
              }}
            />
          ))}
        </div>

        <div className="relative max-w-5xl mx-auto px-6 py-16 text-center">
          {/* Brain SVG doodle */}
          <div className="float-anim inline-block mb-6">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
              <ellipse cx="40" cy="42" rx="30" ry="26" fill="#FFB7C5" />
              <line x1="40" y1="18" x2="40" y2="62" stroke="#FF8FAB" strokeWidth="1.5" />
              <path d="M25 32 Q18 28 22 36" stroke="#FF8FAB" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M22 42 Q14 40 20 48" stroke="#FF8FAB" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M55 32 Q62 28 58 36" stroke="#FF8FAB" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M58 42 Q66 40 60 48" stroke="#FF8FAB" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <circle cx="33" cy="50" r="3" fill="#1a1a2e" />
              <circle cx="47" cy="50" r="3" fill="#1a1a2e" />
              <circle cx="34" cy="49" r="1" fill="white" />
              <circle cx="48" cy="49" r="1" fill="white" />
              <path d="M35 56 Q40 61 45 56" stroke="#1a1a2e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M36 18 Q40 8 44 18" stroke="#4A90E2" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-3 tracking-tight">
            Muscle
            <span style={{ color: "#FFB7C5" }}> → </span>
            Machine
          </h1>
          <p className="text-lg font-light mb-1" style={{ color: "#a8c4e0" }}>
            Electromyography-Powered Human-Computer Interaction
          </p>
          <p className="text-sm max-w-xl mx-auto mt-3 leading-relaxed" style={{ color: "#7a9dbf" }}>
            Using an ESP32 to bridge the gap between neuromuscular biopotentials and digital interaction.
            Open-source. Sub-$35. Built for outreach.
          </p>

          {/* Pill badges */}
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            {["ESP32 Bluetooth", "AD8232", "Action Potentials", "HID Protocol", "Open Source"].map((tag) => (
              <span
                key={tag}
                className="text-xs px-3 py-1 rounded-full font-medium"
                style={{ background: "rgba(74,144,226,0.18)", color: "#a8c4e0", border: "1px solid rgba(74,144,226,0.3)" }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── TABS ─────────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-30"
        style={{ background: "rgba(253,252,240,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid #e5e4d8" }}
      >
        <div className="max-w-5xl mx-auto px-4">
          <nav className="flex gap-1 overflow-x-auto py-2" style={{ scrollbarWidth: "none" }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-150 cursor-pointer"
                style={{
                  background: activeTab === tab.id ? "var(--neuro-blue)" : "transparent",
                  color: activeTab === tab.id ? "white" : "#666677",
                  boxShadow: activeTab === tab.id ? "0 2px 10px rgba(74,144,226,0.35)" : "none",
                }}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* ── CONTENT ──────────────────────────────────────────────────────── */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">

        {/* ── GAME TAB ── */}
        {activeTab === "game" && (
          <section className="flex flex-col items-center gap-8">
            <div className="text-center max-w-lg">
              <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--dark)" }}>
                Brain-Bird
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: "#666677" }}>
                A Flappy-Bird clone where your EMG signal is the controller. In this browser demo,{" "}
                <strong>Space</strong> or a screen tap simulates a muscle contraction. At the outreach booth,
                a forearm flex triggers the same HID keypress over Bluetooth.
              </p>
            </div>

            <BrainBird />

            {/* Signal diagram */}
            <div
              className="w-full rounded-2xl p-5"
              style={{ background: "#f0f4ff", border: "1.5px solid #c7d8f8", maxWidth: 700 }}
            >
              <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: "var(--neuro-blue)" }}>
                Signal Pipeline
              </p>
              <div className="flex items-center justify-between text-xs text-center" style={{ gap: 4 }}>
                {[
                  { label: "Muscle Flex", icon: "💪", color: "#FFB7C5" },
                  { label: "Electrical Signal", icon: "⚡", color: "#fbbf24" },
                  { label: "Muscle Sensor", icon: "📡", color: "#4A90E2" },
                  { label: "Microcontroller", icon: "🔧", color: "#34d399" },
                  { label: "Wireless (Bluetooth)", icon: "📶", color: "#a78bfa" },
                  { label: "Game Input", icon: "🧠", color: "#FFB7C5" },
                ].map((step, i, arr) => (
                  <div key={i} className="flex items-center" style={{ gap: 4 }}>
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-sm shrink-0"
                        style={{ background: step.color + "30", border: `2px solid ${step.color}` }}
                      >
                        {step.icon}
                      </div>
                      <span className="leading-tight" style={{ color: "#444455", maxWidth: 72 }}>{step.label}</span>
                    </div>
                    {i < arr.length - 1 && (
                      <svg width="14" height="10" viewBox="0 0 16 10" className="shrink-0 mb-4">
                        <path d="M0 5 H12 M8 1 L14 5 L8 9" stroke="#9999aa" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── VIDEO TAB ── */}
        {activeTab === "video" && (
          <section className="flex flex-col items-center gap-8 max-w-2xl mx-auto">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--dark)" }}>
                Outreach in Action: EMG-Controlled Interface
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: "#666677" }}>
                Using an ESP32 to bridge the gap between neuromuscular biopotentials and digital interaction.
                Recorded live at a STEM outreach event — no script, no cuts.
              </p>
            </div>

            {/* Video placeholder */}
            <div
              className="w-full aspect-video rounded-2xl flex flex-col items-center justify-center gap-4 cursor-pointer group transition-all duration-200"
              style={{
                background: "linear-gradient(135deg, #1a1a2e, #0f3460)",
                border: "2px dashed rgba(74,144,226,0.4)",
                boxShadow: "0 8px 32px rgba(74,144,226,0.15)",
              }}
            >
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center transition-transform duration-150 group-hover:scale-110"
                style={{ background: "rgba(74,144,226,0.2)", border: "2px solid rgba(74,144,226,0.5)" }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="#4A90E2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-white font-semibold">Demo Video — Coming Soon</p>
                <p className="text-sm mt-1" style={{ color: "#7a9dbf" }}>
                  Drop a video file here or replace this placeholder with a{" "}
                  <code className="text-xs px-1 rounded" style={{ background: "rgba(74,144,226,0.2)", color: "#4A90E2" }}>
                    &lt;video&gt;
                  </code>{" "}
                  tag
                </p>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4 w-full">
              {[
                { label: "Signal Latency", value: "<5 ms", sub: "ADC → Bluetooth packet" },
                { label: "Detection Accuracy", value: "~94%", sub: "squeeze vs. noise" },
                { label: "Total BOM Cost", value: "~$35", sub: "ESP32 + sensor + breadboard + cable" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl p-4 text-center"
                  style={{ background: "white", border: "1.5px solid #e5e4d8", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}
                >
                  <p className="text-2xl font-bold" style={{ color: "var(--neuro-blue)" }}>{stat.value}</p>
                  <p className="text-xs font-semibold mt-1" style={{ color: "var(--dark)" }}>{stat.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "#9999aa" }}>{stat.sub}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── FAQ TAB ── */}
        {activeTab === "faq" && (
          <section className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--dark)" }}>
                Frequently Asked Questions
              </h2>
              <p className="text-sm" style={{ color: "#666677" }}>
                Pre-med, curious visitor, or fellow engineer — these cover the most common questions from outreach events.
              </p>
            </div>
            <FAQ />
          </section>
        )}

        {/* ── BUILD TAB ── */}
        {activeTab === "build" && (
          <section className="max-w-3xl mx-auto flex flex-col gap-10">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--dark)" }}>
                Materials &amp; Build Guide
              </h2>
              <p className="text-sm" style={{ color: "#666677" }}>
                Everything you need to replicate this project. Total cost: ~$35. Build time: ~2 hours.
              </p>
            </div>

            {/* BOM */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--neuro-blue)" }}>
                Bill of Materials
              </h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {MATERIALS.map((item) => (
                  <a
                    key={item.name}
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-4 p-4 rounded-2xl transition-all duration-150 hover:-translate-y-0.5"
                    style={{
                      background: "white",
                      border: "1.5px solid #e5e4d8",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                      textDecoration: "none",
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-lg mt-0.5"
                      style={{ background: item.color + "20", border: `1.5px solid ${item.color}40` }}
                    >
                      {item.name.includes("ESP") ? "🔌" : item.name.includes("AD") ? "📡" : item.name.includes("Electrode") ? "🩹" : "📦"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-sm" style={{ color: "var(--dark)" }}>{item.name}</p>
                        <span className="text-xs font-bold shrink-0" style={{ color: item.color }}>{item.price}</span>
                      </div>
                      <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "#666677" }}>{item.desc}</p>
                    </div>
                    <svg
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="#9999aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>

            {/* Wiring diagram placeholder */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--neuro-blue)" }}>
                Wiring (AD8232 → ESP32)
              </h3>
              <div
                className="rounded-2xl p-5"
                style={{ background: "#0d1117", border: "1.5px solid #30363d" }}
              >
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr style={{ color: "#8b949e" }}>
                      <th className="text-left pb-2 font-medium">AD8232 Pin</th>
                      <th className="text-left pb-2 font-medium">ESP32 Pin</th>
                      <th className="text-left pb-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["3.3V", "3V3", "Power"],
                      ["GND", "GND", "Common ground"],
                      ["OUTPUT", "GPIO 35", "Analog signal (ADC)"],
                      ["LO+", "GPIO 25", "Leads-off detect (optional)"],
                      ["LO−", "GPIO 26", "Leads-off detect (optional)"],
                      ["SDN", "3V3", "Enable chip (tie high)"],
                    ].map(([a, b, note], i) => (
                      <tr key={i} style={{ borderTop: "1px solid #21262d" }}>
                        <td className="py-2" style={{ color: "#ff7b72" }}>{a}</td>
                        <td className="py-2" style={{ color: "#79c0ff" }}>{b}</td>
                        <td className="py-2" style={{ color: "#8b949e" }}>{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Code */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--neuro-blue)" }}>
                ESP32 Bluetooth-Keyboard Firmware
              </h3>
              <CodeBlock code={ESP32_CODE} language="cpp" filename="emg_hid.ino" />
            </div>

            {/* GitHub CTA */}
            <div
              className="rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4"
              style={{
                background: "linear-gradient(135deg, #1a1a2e, #0f3460)",
                boxShadow: "0 4px 24px rgba(74,144,226,0.2)",
              }}
            >
              <div>
                <p className="font-semibold text-white text-lg">Full Repository on GitHub</p>
                <p className="text-sm mt-1" style={{ color: "#7a9dbf" }}>
                  Includes schematics, firmware, 3D-print files for the enclosure, and this web demo.
                </p>
              </div>
              <a
                href="https://github.com/UZSaeed/brainbird"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm shrink-0 transition-all duration-150 hover:opacity-90 active:scale-95"
                style={{ background: "var(--neuro-blue)", color: "white", textDecoration: "none" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                </svg>
                View on GitHub
              </a>
            </div>
          </section>
        )}
      </main>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer
        className="mt-16 py-8 text-center text-xs"
        style={{ borderTop: "1px solid #e5e4d8", color: "#9999aa" }}
      >
        <p>
          Built for STEM outreach · EMG-HCI Demo · Open-source under MIT License
        </p>
        <p className="mt-1">
          AD8232 · ESP32 · Bluetooth HID · HTML5 Canvas · Next.js
        </p>
      </footer>
    </div>
  );
}
