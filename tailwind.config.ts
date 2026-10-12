import type { Config } from "tailwindcss";

export default {
    darkMode: ["class"],
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // Shared class strings live here too — settledRowClass and
    // shopifyRowClass in lib/utils.ts. Without this glob those utilities are
    // only emitted when the same class happens to appear in a scanned file,
    // so a row style works or silently does not depending on coincidence.
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		fontSize: {
  			// One micro step instead of the three arbitrary sizes that had crept
  			// in (9px, 10px, 11px). 11px is the floor: below that, muted grey
  			// text is not readable on a phone in a shop.
  			'2xs': ['0.6875rem', { lineHeight: '0.875rem' }],
  			// The app's SF text styles (docs/features/web-matches-app.md a.3). Size and line only;
  			// the weight is the caller's (semibold for headlines, bold for the large title).
  			'ios-large': ['2.125rem', { lineHeight: '2.5625rem' }],
  			'ios-title2': ['1.375rem', { lineHeight: '1.75rem' }],
  			'ios-title3': ['1.25rem', { lineHeight: '1.5625rem' }],
  			'ios-headline': ['1.0625rem', { lineHeight: '1.375rem' }],
  			'ios-sub': ['0.9375rem', { lineHeight: '1.25rem' }],
  			'ios-foot': ['0.8125rem', { lineHeight: '1.125rem' }],
  			'ios-cap': ['0.75rem', { lineHeight: '1rem' }],
  		},
  		// New York on Apple devices (the app's figures and section headings), Georgia elsewhere.
  		fontFamily: {
  			serif: ['ui-serif', '"New York"', 'Georgia', 'Cambria', '"Times New Roman"', 'serif'],
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				foreground: 'hsl(var(--success-foreground))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				foreground: 'hsl(var(--warning-foreground))'
  			},
  			// List dividers (the iOS opaque separator); cards have no border at all.
  			separator: 'hsl(var(--separator))',
  			// The app's Tone: nothing else picks a colour. DEFAULT is the fill (tints, bars,
  			// icons), `ink` is for text and small icons. lib/tones.ts maps a Tone to these.
  			tone: {
  				late: { DEFAULT: 'hsl(var(--tone-late))', ink: 'hsl(var(--tone-late-ink))' },
  				owed: { DEFAULT: 'hsl(var(--tone-owed))', ink: 'hsl(var(--tone-owed-ink))' },
  				settled: { DEFAULT: 'hsl(var(--tone-settled))', ink: 'hsl(var(--tone-settled-ink))' },
  				credit: { DEFAULT: 'hsl(var(--tone-credit))', ink: 'hsl(var(--tone-credit-ink))' },
  				working: { DEFAULT: 'hsl(var(--tone-working))', ink: 'hsl(var(--tone-working-ink))' },
  				quiet: { DEFAULT: 'hsl(var(--tone-quiet))', ink: 'hsl(var(--tone-quiet-ink))' },
  				house: { DEFAULT: 'hsl(var(--tone-house))', ink: 'hsl(var(--tone-house-ink))' },
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)',
  			// The app's shapes (globals.css --r-*): card 22, standalone card 20, quick-action tile 14,
  			// date leaf 10, form field 12. Capsules are rounded-full.
  			card: 'var(--r-card)',
  			'card-sm': 'var(--r-card-sm)',
  			tile: 'var(--r-tile)',
  			leaf: 'var(--r-leaf)',
  			control: 'var(--r-control)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
        'scan-line': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        }
  		},
  		// The ERP's motion (docs/decisions.md#motion): things arrive on a soft ease-out, leave on a quick
  		// ease-in, and sheets travel on the iOS sheet curve. tailwindcss-animate reads these for its
  		// animate-in / animate-out too, so `data-[state=open]:ease-enter` sets the keyframes' timing.
  		transitionTimingFunction: {
  			enter: 'cubic-bezier(0.22, 1, 0.36, 1)',
  			exit: 'cubic-bezier(0.4, 0, 1, 1)',
  			sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
  			'accordion-up': 'accordion-up 0.16s cubic-bezier(0.4, 0, 1, 1)',
        'scan-line': 'scan-line 3s ease-in-out infinite',
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
