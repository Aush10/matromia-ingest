# Matromia Ingest

Private archive and structured reference for the Matromia tabletop campaigns.

## Start here

- [`Matromia_Game_Cram_Guide.md`](Matromia_Game_Cram_Guide.md) — shortest pre-game refresher.
- [`Matromia_Overview.md`](Matromia_Overview.md) — distinguishes the main Ashen Echoes campaign, Southern Frostlands campaign, reference material, and Abyss roleplay.
- [`Matromia_Lookup_Index.md`](Matromia_Lookup_Index.md) — routes questions to the correct source file.
- [`Matromia_Player_Character_Profiles.md`](Matromia_Player_Character_Profiles.md) — player/character mapping and profiles.
- [`Matromia_Settings_Gazetteer.md`](Matromia_Settings_Gazetteer.md) — nations, locations, metaphysics, gods, factions, relics, and current pressures.

## Source authority

Use newer GM rulings and session recaps first, followed by player-authored character records, current project status, older encyclopedia entries, in-world news, and finally speculative build notes.

## Audio study edition

The narration source is in [`audio_script`](audio_script), with voice direction in [`Matromia_Audio_Instructions.txt`](Matromia_Audio_Instructions.txt). `render_matromia_audio.ps1` renders six MP3 chapters after `OPENAI_API_KEY` is configured locally. Generated audio belongs under `output/speech` and temporary jobs under `tmp/speech`.

## Autumn Solstice lookup app

Autumn is a local Matromia Q&A and archive-management prototype designed so its core can later sit behind a Discord adapter. It provides:

- full-text canon search over a generated hidden inventory;
- source-grounded Q&A through the OpenAI Responses API;
- pins and favorites stored per local user;
- author-gated file creation, section append, and section replacement;
- clear separation between canon, unconfirmed rumors, and non-canon dreams;
- listener-owned mood, rejection, ignore, nap, and wake state;
- a warm in-world kitsune bard persona with controlled low-stakes bardic lying;
- no write tools in the model call.

### Setup

1. Copy `.env.example` to `.env`.
2. Put the same `OPENAI_API_KEY` used for speech in `.env`.
3. Set a separate long random `AUTUMN_AUTHOR_KEY`. Never reuse the OpenAI key as an author credential.
4. Run `./start_autumn.ps1`, or run `npm start`.
5. Open `http://127.0.0.1:8787`.

Without an OpenAI key, lookup, flags, ingestion, state listeners, and a source-excerpt fallback still work. The default model is `gpt-6-luna`; override it with `AUTUMN_MODEL`.

### Commands

- `npm run index` rebuilds `.autumn-cache/inventory-index.json`.
- `npm test` runs index, ingestion, ignore, and nap-state tests.
- `Debug: <request>` breaks character only when the correct author key accompanies the message.
- `wakeup autumn` wakes a token-exhausted Autumn only when the correct author key accompanies it.

The default reply cap is 350 output tokens. Each local user receives a 2,400-token wake cycle; Autumn yawns near the limit and becomes silent after her nap message until an author wakes her.

### Data ownership

- `AUTUMN_AI.md` defines Autumn's character and truth contract.
- `.autumn-cache/inventory-index.json` is generated, local, and Git-ignored.
- `data/rumors.json` is listener-owned unconfirmed information.
- `data/opinions.json` is listener-owned mood, ignore, and nap state.
- `data/user_flags.json` stores local pins and favorites.

Those three live state files are Git-ignored so moods, ignore lists, and personal flags are not accidentally pushed. Their committed `*.example.json` files document the initial placeholder schemas; the service creates live files when listeners first write them.

The browser calls local JSON endpoints under `/api`. A future Discord listener can call the same search, state, and ingestion modules without granting Autumn filesystem tools.

## Privacy note

This repository is private. Some raw Discord exports contain historical self-hosted service addresses and external document links. Treat them as private archival material, not current public endpoints.
