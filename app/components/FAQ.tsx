"use client";

import { useState } from "react";

const faqs = [
  {
    q: "What is an EMG?",
    a: "Electromyography (EMG) measures the electrical activity produced by skeletal muscles during contraction. When a motor neuron fires, it triggers an action potential that propagates along the muscle fiber — EMG captures the summation of many such potentials as a microvolt-level electrical signal detectable at the skin surface.",
    tag: "Physiology",
  },
  {
    q: "What exactly are we measuring?",
    a: "We are detecting the summation of action potentials at the Neuromuscular Junction (NMJ) as you flex your forearm. Each motor unit (one neuron + all muscle fibers it innervates) fires synchronously, and the cumulative electrical field of hundreds of motor units is what the AD8232 differential amplifier picks up.",
    tag: "Signal",
  },
  {
    q: "Why the ESP32?",
    a: "The ESP32 provides built-in Bluetooth Low Energy (BLE), allowing us to convert biological signals into standard HID (Human Interface Device) inputs — like a keyboard keypress — without any wires to the host computer. It also has a 12-bit ADC and sufficient processing power to apply a simple threshold algorithm in real time.",
    tag: "Hardware",
  },
  {
    q: "Why use an ECG kit for EMG?",
    a: "Both ECG and EMG utilize differential amplifiers to detect microvolt-level changes in bioelectric potential. For a simple binary 'squeeze' trigger, the AD8232's instrumentation amplifier and bandpass filtering (0.5–40 Hz) is more than sufficient. It's also inexpensive (<$8) and widely available, making it ideal for open-source outreach demos.",
    tag: "Hardware",
  },
  {
    q: "Is it safe?",
    a: "Yes. The circuit operates at 3.3 V logic level and senses only — it does not pass current through the body. The AD8232 includes galvanic isolation by design. Electrode impedances and the differential measurement topology reject common-mode noise (like 60 Hz mains hum), and there is no therapeutic or stimulation component whatsoever.",
    tag: "Safety",
  },
  {
    q: "Can I build this myself?",
    a: "Absolutely — it's fully open-source. The total BOM is under $25: an ESP32 dev board (~$5), an AD8232 ECG module (~$8), three snap electrodes (~$2), and jumper wires. The firmware is Arduino C++ and the repository linked below includes schematics, code, and a step-by-step build guide.",
    tag: "DIY",
  },
];

const tagColors: Record<string, { bg: string; text: string }> = {
  Physiology: { bg: "#FFE4EC", text: "#c0446a" },
  Signal: { bg: "#D6E8FB", text: "#2563eb" },
  Hardware: { bg: "#e8f5e9", text: "#2e7d32" },
  Safety: { bg: "#fff3e0", text: "#e65100" },
  DIY: { bg: "#f3e8ff", text: "#7c3aed" },
};

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (i: number) => setOpenIndex(openIndex === i ? null : i);

  return (
    <div className="flex flex-col gap-3">
      {faqs.map((faq, i) => {
        const isOpen = openIndex === i;
        const tag = tagColors[faq.tag] ?? { bg: "#eee", text: "#555" };
        return (
          <div
            key={i}
            className="rounded-2xl overflow-hidden transition-all duration-200"
            style={{
              border: `1.5px solid ${isOpen ? "var(--neuro-blue)" : "#e5e4d8"}`,
              background: isOpen ? "#f8f7ff" : "white",
              boxShadow: isOpen ? "0 4px 18px rgba(74,144,226,0.10)" : "0 1px 4px rgba(0,0,0,0.05)",
            }}
          >
            <button
              onClick={() => toggle(i)}
              className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <span
                  className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                  style={{ background: tag.bg, color: tag.text }}
                >
                  {faq.tag}
                </span>
                <span className="font-medium text-sm" style={{ color: "var(--dark)" }}>
                  {faq.q}
                </span>
              </div>
              <svg
                className="shrink-0 ml-3 transition-transform duration-300"
                style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", color: "var(--neuro-blue)" }}
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div className={`faq-content ${isOpen ? "open" : ""}`}>
              <p className="px-5 pb-5 text-sm leading-relaxed" style={{ color: "#444455" }}>
                {faq.a}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
