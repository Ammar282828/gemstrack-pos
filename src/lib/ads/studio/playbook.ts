/**
 * The Ad studio's Guide: how Meta ads work for this house in particular — not a
 * general course. Each point is either how Meta behaves (and so binds every
 * advertiser) or the vault's own rule turned into a setting. Shown on the Guide and
 * read by nothing else; the model's rules live in brand.ts.
 */

export interface PlaybookSection { id: string; title: string; lead: string; points: { head: string; body: string }[] }

export const PLAYBOOK: PlaybookSection[] = [
  {
    id: 'job', title: 'What an ad is for',
    lead: 'The vault’s rule for every channel: WhatsApp closes; everything else routes into WhatsApp. An ad is judged by the conversations it opens.',
    points: [
      { head: 'Buy conversations, not reach', body: 'Goal “WhatsApp chats” (Meta: Engagement → Messaging). The number that matters is cost per conversation started, then how many of those conversations the counter turns into a visit. Likes and reach are not the job.' },
      { head: 'Let the button ask', body: 'The ad’s button already says “Send message”; the words only need to make someone curious enough to press it. A question about price is exactly the conversation the ad was bought for — which is why the ad never states one.' },
      { head: 'Answer fast', body: 'A chat answered in minutes becomes a visit; one answered tomorrow is lost money. Run ads when someone can reply (Sat–Thu 11:00–21:00, Fri from 15:30), and keep the WhatsApp greeting set on Ads → Setup for the rest.' },
    ],
  },
  {
    id: 'who', title: 'Who sees it',
    lead: 'Meta removed targeting by religion and community in 2022 — no ad can be aimed at “Bohra”. The community is reached through who already knows the house, and through the ad itself.',
    points: [
      { head: 'Start from your own customers', body: 'Ads → Audiences makes a Meta audience from the ERP’s customers (hashed on this server, nothing readable leaves it). Use it as the suggestion for Advantage+ audience, and as the seed for a 1% lookalike.' },
      { head: 'People who already engaged', body: 'Instagram engagers of @collectionstaheri over the last 90–365 days are the warmest audience after customers — they know the name.' },
      { head: 'Karachi, near the shop', body: 'A radius around the shop plus the neighbourhoods the customer list comes from. Wider than that spends on people who will never visit.' },
      { head: 'Fit is in the picture', body: 'Cultural fit — restraint, the occasions the community keeps, the English-with-a-warm-Urdu-close voice — is carried by the creative. The targeting only finds people; the ad makes them feel it is theirs.' },
    ],
  },
  {
    id: 'show', title: 'What to show',
    lead: 'On a phone the ad has about a second. The piece must be recognisable at thumbnail size before anyone reads a word.',
    points: [
      { head: 'The piece fills the frame', body: 'One piece per ad, large, sharp and lit so gold glows and stones spark. The Picks rank the library for exactly this; anything under about 70 needs a fix first.' },
      { head: '4:5 for feeds, 9:16 for stories', body: 'A 4:5 picture takes the most room in a feed; stories and reels are 9:16 with Instagram’s buttons over the top 14% and bottom 35%. The maker makes both from one photo — New ad makes one ad per picture, so run the 9:16 as its own ad beside the 4:5.' },
      { head: 'No weights, karats or prices on the picture', body: 'taheri.shop’s photos carry burned-in weights and marks for the website; for an ad, “Clear old labels” takes them off and the maker puts back one mark, quietly.' },
      { head: 'Test one thing at a time', body: 'Two ads the same but for the picture (packshot against on-hand, plain against a setting) tell you something; two ads different in everything tell you nothing. Three to five ads in an ad set is plenty.' },
      { head: 'Refresh before it tires', body: 'When the same people have seen an ad three times (frequency 3+), or its cost per chat climbs well above the account’s usual, replace the picture — Overview’s “Needs a look” flags both.' },
    ],
  },
  {
    id: 'words', title: 'The words',
    lead: 'The vault’s Instagram formula holds for ads: copy complements the picture, it never describes it.',
    points: [
      { head: 'Two sentences', body: 'One concrete observation about the work, one about how it is worn; about half the time a closing thought of four to seven words. Feeds cut after about 125 characters, so the first sentence must stand alone.' },
      { head: 'A soft invitation', body: '“DM us to enquire”, “Inquiries welcome”, “Available in-store and by appointment”, “To view this piece, reach out directly”. Never “Shop now”, never urgency, never a hashtag.' },
      { head: 'Statement pieces, statement words', body: 'Match the volume of the writing to the piece. A diamond set gets light, brilliance, permanence — “set by hand, held for generations” — never “investment”.' },
    ],
  },
  {
    id: 'money', title: 'The budget',
    lead: 'Meta’s delivery learns from results: it needs about fifty in a week in one ad set to settle, which a jeweller’s budget rarely buys.',
    points: [
      { head: 'Fewer ad sets, not more', body: 'At a shop’s budget, one ad set with three to five pictures learns faster than five ad sets with one picture each. “Learning limited” on Overview means the ad set is starved.' },
      { head: 'Judge after days, not hours', body: 'Give a new ad three or four days before pausing it; the first day’s cost per chat is noise.' },
      { head: 'A daily budget of several chats', body: 'Set the daily budget at five to ten times the cost of a chat you are happy to pay; less and Meta can’t find the people who reply.' },
    ],
  },
  {
    id: 'when', title: 'When',
    lead: 'The vault: on any sacred date no products and no calls to action, and not in the days just before either. The calendar above works these out from the Hijri date.',
    points: [
      { head: 'Stop ads before sacred days, not on them', body: 'End campaigns before Ashara’s quiet days begin and before each Eid; an ad that is “only paused on the day” was still running the day before.' },
      { head: 'The windows', body: 'The weeks before Eid al-Fitr (gifting) and the wedding months (roughly November to February) are when the community buys — framed as the occasion, never as “bridal”.' },
      { head: 'The lunar first', body: 'The first of each lunar month is the house’s fixed cultural post: keep product ads off that day.' },
    ],
  },
  {
    id: 'measure', title: 'Knowing it worked',
    lead: 'Meta counts chats; the ERP counts sales. Only the two together say whether an ad paid.',
    points: [
      { head: 'Ask every new chat', body: '“How did you find us?” — and note it on the customer. It is the one link between an ad and an invoice Meta can’t see.' },
      { head: 'Compare the month', body: 'Sales to new customers in the ERP against the month’s ad spend (Overview’s month line) — the only return that matters.' },
      { head: 'Keep what wins', body: 'The Guide’s “What your own ads say” reads the account’s cheapest and dearest results side by side; make the next ads from the winners’ pattern.' },
    ],
  },
];
