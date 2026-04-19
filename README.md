# 🐑 Shepherd

> **Think before you prompt.**

[![Status](https://img.shields.io/badge/status-active%20development-yellow)]()
[![License](https://img.shields.io/badge/license-TBD-lightgrey)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)]()
[![Built with](https://img.shields.io/badge/built%20with-vanilla%20JS-blue)]()

Shepherd is a Chrome extension that adds a **behavioral layer** to AI tools like ChatGPT.

It helps people:
- pause before prompting
- write better inputs
- use AI with intent instead of instinct

> The human should direct the machine — not get back-led by it.

---

## 🚀 Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/shepherd.git
cd shepherd
```

### 2. Load extension in Chrome
- Go to chrome://extensions
- Enable Developer Mode
- Click Load unpacked
- Select the project folder
  
### 3. Open ChatGPT

Shepherd will inject automatically.

## 🧠 What is Shepherd?

AI chat interfaces are optimized for:

- speed
- continuation
- engagement

That creates:

- shallow prompts
- reactive loops
- loss of intentional thinking

Shepherd introduces friction and structure.

## ⚙️ Modes
### 🌿 Explore Mode (v1 focus)

Calm the environment. Reduce drift.

- hides distracting UI (sidebar, suggestions, discovery)
- no interruptions
- ambient, workspace-like feel

Inspired by calm tools like [Momentum](https://momentumdash.com/)

### 🔒 Strict Mode (experimental)

Interrupt reflex. Force intent.

#### Prompt Gate before sending
![Screenshot pending](#)

#### `Edit` vs `Send anyway` triggers on:
- first prompt
- short prompts
- rapid prompts

Inspired by enforcement tools like [Cold Turkey Blocker](https://getcoldturkey.com/)

⚠️ Note: Strict mode is not fully reliable yet (send blocking is still being solved)

## 🗺 Roadmap
### ✅ v1 — Explore Mode

 - Mode toggle
 - DOM hiding system
 - Mutation observer for re-renders
 - Live mode switching
 - Selector hardening
 - UX polish
   
### 🚧 v1.5 — Strict Mode

- Prompt Gate UI
- Send detection
- True send blocking (critical blocker)
- Reliable resend flow
- Trigger tuning

## 🆘 Help Wanted (High Impact)

This is where contributors can make a real difference.

### 1. Solve send blocking (Strict mode)

**Problem:** ChatGPT still sends prompts even after interception.

**Goal:** Prompt should NEVER send until user confirms.

#### Areas to explore:

- React event pipeline
- form submission path
- deeper DOM control strategies
- alternative interception methods

This is the single most important problem in the repo.

### 🧱 2. Harden Explore mode selectors

**Problem:** ChatGPT DOM changes frequently.

**Goal:**

- fewer broken selectors
- fewer false positives
- resilient hiding

**Ideas:**

- better selector grouping
- semantic targeting
- fallback strategies

### 🔁 3. Improve DOM re-render handling

**Problem:** UI reappears after React updates.

**Goal:**

- smarter MutationObserver usage
- less brute-force re-hiding
- better performance

### 🧪 4. Debug tooling

**Goal:** Make Shepherd easier to reason about.

**Ideas:**

- better logging structure
- debug UI toggle
- event tracing improvements
  
## 🧱 Tech Stack
Manifest V3
Vanilla JavaScript
Chrome Extension APIs
No backend
No framework

This is intentional.

## 📁 Structure
```
shepherd/
├─ manifest.json
├─ content.js        # core logic (everything important)
├─ content.css       # modal + styles
├─ popup.html        # UI
├─ popup.js          # mode toggle
├─ icons/
└─ README.md
```

## 🧪 Debugging Notes

This project lives in the messy intersection of:

- DOM mutation
- React internals
- browser event systems

Common issues:
- ChatGPT re-renders break selectors
- events fire but don’t actually block behavior
- duplicate listeners
- synthetic vs native events mismatch

Tools included:
- verbose logging
- debug helpers (ShepherdDebug)
- event diagnostics

## 🧭 Contribution Guidelines

**Do:**
- keep code simple
- prefer explicit over abstract
- log aggressively when unsure
- test directly in ChatGPT

**Don’t:**
- introduce frameworks
- over-engineer systems
- add features before core behavior works

## 🧠 Product Principles

Before adding anything, ask:

> "Does this increase intentionality for the user?"

If not, cut it.

## 🎯 Design Principles

### Explore mode = ambient
- calm
- minimal
- non-intrusive

### Strict mode = decisive
- interruptive
- intentional
- impossible to ignore

## ❓ Open Questions
- What is the true ChatGPT send path?
- What’s the cleanest way to block it?
- Should Strict mode be default or opt-in?
- How minimal can Explore mode be?

## 🤝 Contributing
- Fork the repo
- Create a branch
- Make changes
- Open a PR

**Include:**

- what you tested
- expected behavior
- actual behavior
- logs/screenshots if relevant

## 📜 License

[MIT License]((./License))

## 🐑 Final Thought

AI shouldn’t replace thinking.
It should make thinking better.

If that resonates, jump in.
