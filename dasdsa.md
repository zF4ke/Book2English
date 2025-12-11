# Book to English

> Make every book accessible in English.

A little web app for reading books in English, even when they were not written that way. You drop in a PDF and it translates as you read.

Everything stays in your browser, no accounts, no uploads, just you and the book.

## How it works

The whole thing is designed to feel like sitting at a reading desk, with parchment backgrounds and serif fonts. The original page sits next to the translation so you can glance over when you're curious.

It translates a few pages ahead while you're reading, so flipping forward doesn't make you wait. If you go back to re-read something, it will already be there. You can also type a page number to jump, and it waits until you're done typing.

You can adjust font sizes and colors, change how many pages get translated at once, clear the cache whenever you want, and bring your own API key which lives in your browser and only gets sent when asking for a translation.
 
### Tech stuff
Built with Next.js, TypeScript, and Tailwind. Uses `react-pdf` to show the pages and Gemini for the translations.

## Getting Started

1. **Clone the repo**
   ```bash
   git clone https://github.com/zF4ke/Book2English.git
   cd Book2English
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run it**
   ```bash
   npm run dev
   ```

4. **Bring your Key**
   Open the settings menu (bottom right) and paste your Gemini API key. It's stored locally in your browser.

## Why?
Because language shouldn't be a barrier to knowledge.
