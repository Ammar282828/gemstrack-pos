# Fonts

Google Fonts' own latin cuts (woff2), downloaded 2026-09-30 from the addresses
`next/font/google` used, so the build never fetches from Google. Loaded with
`next/font/local` in `src/app/layout.tsx` (Inter), `src/app/links/page.tsx`
(Bodoni Moda, Newsreader) and `src/app/website/post/fonts.ts` (the story, post
and ad faces).

Inter, Figtree, Sofia Sans Extra Condensed, Bodoni Moda, Cormorant Garamond,
Playfair Display, Great Vibes, Montserrat, Cinzel, Newsreader, Cormorant Infant, Italiana, Jost, Tenor Sans, DM Serif Display and Marcellus (the last six: @fontsource's latin cuts, added 2026-10-12 for the designer) are all under
the SIL Open Font License 1.1 (https://openfontlicense.org), © their authors.

`futura-lt-light.woff2` is taheri.shop's own weight face (its `WeightLabel`), the same file as
`public/fonts/futura-lt-light.woff2` (the canvas stamp loads that one by URL): loaded with `next/font/local` in
`src/app/website/weights/fonts.ts` for Photo weights' preview.
