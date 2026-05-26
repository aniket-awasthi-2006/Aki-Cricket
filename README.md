# Aki Cricket

Interactive cricket mind-reader game built with Next.js, Firebase Auth, Firestore, and Gemini.

## Live Link

Add your deployed app URL here:

[Click to Open Live app](https://aki-cricket-by-aniket-and-ansh-chor.vercel.app)

## Features

- Email/password and Google sign-in with Firebase Authentication
- Secure server-side session cookie flow
- AI-generated cricket questions and final reveal (Gemini)
- Fallback question flow when Gemini is unavailable
- Game session tracking and stats in Firestore
- Sound effects, timer pressure, and animated game UI

## Tech Stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS 4
- Firebase (Auth + Firestore)
- JOSE (JWT verification/encrypted session token)
- Gemini API (`gemini-2.5-flash`)

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill values:

```bash
cp .env.local.example .env.local
```

Required variables:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`
- `FIREBASE_PROJECT_ID` (optional if same as `NEXT_PUBLIC_FIREBASE_PROJECT_ID`)
- `AUTH_JWT_SECRET` (long random secret)
- `GEMINI_API_KEY`

## Run Locally

```bash
npm install
npm run dev
```

Open: `http://localhost:3000`

## Scripts

- `npm run dev` - start dev server
- `npm run build` - production build
- `npm run start` - run production server
- `npm run lint` - run ESLint

## Project Structure

```text
app/
  api/
    auth/session/route.ts
    game/next-question/route.ts
  components/
  dashboard/page.tsx
  lib/
proxy.ts
```
