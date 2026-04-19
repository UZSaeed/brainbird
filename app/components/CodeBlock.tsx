"use client";

import { useState } from "react";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
}

export default function CodeBlock({ code, language = "cpp", filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "#0d1117",
        border: "1.5px solid #30363d",
        boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: "#161b22", borderBottom: "1px solid #30363d" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: "#ff5f57" }} />
            <div className="w-3 h-3 rounded-full" style={{ background: "#ffbd2e" }} />
            <div className="w-3 h-3 rounded-full" style={{ background: "#28c840" }} />
          </div>
          {filename && (
            <span className="text-xs font-mono" style={{ color: "#8b949e" }}>
              {filename}
            </span>
          )}
          <span
            className="text-xs px-2 py-0.5 rounded font-mono"
            style={{ background: "#21262d", color: "#4a90e2" }}
          >
            {language}
          </span>
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg transition-all duration-150 cursor-pointer font-medium"
          style={{
            background: copied ? "#1f6feb22" : "#21262d",
            color: copied ? "#4a90e2" : "#8b949e",
            border: `1px solid ${copied ? "#4a90e2" : "#30363d"}`,
          }}
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      {/* Code */}
      <pre
        className="overflow-x-auto p-5 text-sm leading-relaxed"
        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}
      >
        <code dangerouslySetInnerHTML={{ __html: highlight(code, language) }} />
      </pre>
    </div>
  );
}

// Token-based syntax highlighter — processes each line in one pass to avoid
// re-matching inside already-emitted HTML span tags.
function highlight(code: string, lang: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const span = (color: string, italic = false) =>
    `<span style="color:${color}${italic ? ";font-style:italic" : ""}">`;

  const KWS = new Set([
    "void","int","float","bool","true","false","if","else","while","for",
    "return","const","String","uint8_t","uint16_t","long","unsigned","class",
    "private","public","new","delete","nullptr","auto","static",
  ]);

  function highlightCpp(line: string): string {
    // Tokenise: strings → comments → tokens
    type Tok = { kind: "str" | "cmt" | "raw"; val: string };
    const tokens: Tok[] = [];
    let i = 0;
    while (i < line.length) {
      // String literal
      if (line[i] === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== '"') j++;
        tokens.push({ kind: "str", val: line.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
      // Line comment
      if (line[i] === '/' && line[i + 1] === '/') {
        tokens.push({ kind: "cmt", val: line.slice(i) });
        break;
      }
      // Raw character
      tokens.push({ kind: "raw", val: line[i] });
      i++;
    }

    // Merge consecutive raw tokens
    const merged: Tok[] = [];
    for (const t of tokens) {
      if (t.kind === "raw" && merged.at(-1)?.kind === "raw") {
        merged[merged.length - 1].val += t.val;
      } else {
        merged.push({ ...t });
      }
    }

    return merged
      .map(({ kind, val }) => {
        if (kind === "cmt") return `${span("#8b949e", true)}${esc(val)}</span>`;
        if (kind === "str") return `${span("#a5d6ff")}${esc(val)}</span>`;
        // Tokenise raw segment further
        return esc(val).replace(
          /(\b(?:include|define|ifdef|ifndef|endif|pragma)\b)|([A-Za-z_]\w*)\s*(?=\()|(\b[A-Za-z_]\w*\b)|(\d+(?:\.\d+)?)|([#])/g,
          (m, prep, fn, word, num) => {
            if (prep || m === "#include" || m.startsWith("#")) return `${span("#ff7b72")}${m}</span>`;
            if (fn)   return `${span("#d2a8ff")}${m}</span>`;
            if (word) return KWS.has(word) ? `${span("#ff7b72")}${word}</span>` : m;
            if (num)  return `${span("#79c0ff")}${num}</span>`;
            return m;
          }
        );
      })
      .join("");
  }

  const lineNum = (n: number) =>
    `<span style="color:#444d56;user-select:none;margin-right:1.5em;display:inline-block;width:2em;text-align:right">${n}</span>`;

  return code
    .split("\n")
    .map((line, i) => {
      const body =
        lang === "cpp" || lang === "c" ? highlightCpp(line) : esc(line);
      return `${lineNum(i + 1)}${body}`;
    })
    .join("\n");
}
