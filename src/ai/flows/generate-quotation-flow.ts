
'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// --- Input Schema ---
const GenerateQuotationInputSchema = z.object({
  userRequest: z.string().describe("The user's spoken or written request for quotations. E.g., 'I want 3 options for a 21k bridal set around 50 grams.'"),
  currentGoldRate24k: z.number().describe("Current gold rate for 24k per gram."),
  currentGoldRate22k: z.number().describe("Current gold rate for 22k per gram."),
  currentGoldRate21k: z.number().describe("Current gold rate for 21k per gram."),
  currentGoldRate18k: z.number().describe("Current gold rate for 18k per gram."),
});
export type GenerateQuotationInput = z.infer<typeof GenerateQuotationInputSchema>;

// --- Output Schema ---
// We want the AI to structure the response as a list of quotation scenarios.
const QuotationScenarioSchema = z.object({
  scenarioName: z.string().describe("A short name for this option, e.g., 'Budget Option' or 'Heavy Set'."),
  description: z.string().describe("Brief description of what this option entails."),
  karat: z.enum(['18k', '21k', '22k', '24k']).describe("The karat used for this calculation."),
  weightG: z.number().describe("The weight in grams used for this calculation."),
  makingCharges: z.number().describe("Estimated making charges."),
  wastagePercentage: z.number().describe("Wastage percentage applied."),
  stoneCharges: z.number().optional().describe("Charges for stones if applicable."),
  diamondCharges: z.number().optional().describe("Charges for diamonds if applicable."),
  miscCharges: z.number().optional().describe("Any other charges."),
  estimatedTotal: z.number().describe("The final calculated estimated price."),
});

const GenerateQuotationOutputSchema = z.object({
  scenarios: z.array(QuotationScenarioSchema).describe("A list of generated quotation scenarios based on the user request."),
  summaryText: z.string().describe("A brief, polite response to the user summarizing what was generated."),
});
export type GenerateQuotationOutput = z.infer<typeof GenerateQuotationOutputSchema>;


// --- Prompt Definition ---
const prompt = ai.definePrompt({
  name: 'generateQuotationPrompt',
  input: { schema: GenerateQuotationInputSchema },
  output: { schema: GenerateQuotationOutputSchema },
  prompt: `You are an expert jewelry sales assistant. Your goal is to generate structured price quotations based on a customer's request.

  Context:
  - Current 24k Rate: {{currentGoldRate24k}}
  - Current 22k Rate: {{currentGoldRate22k}}
  - Current 21k Rate: {{currentGoldRate21k}}
  - Current 18k Rate: {{currentGoldRate18k}}

  User Request: "{{userRequest}}"

  Instructions:
  1. Analyze the user's request to understand what kind of jewelry they want (e.g., bridal set, ring), the target weight, karat, or budget.
  2. If they ask for "variations" or "options", create 2-3 logical scenarios (e.g., varying weight, varying karat, or different making charges).
  3. Calculate the estimated total for each scenario using the provided gold rates.
     - Formula: (Weight * Rate) + (Weight * Rate * Wastage%) + Making + Stones + Diamonds + Misc.
     - Use reasonable defaults if not specified:
       - Default Wastage: 8-12%
       - Default Making: 2000-5000 per gram depending on complexity (or fixed amount).
  4. Return a structured JSON object containing these scenarios.

  Example Output Structure (JSON):
  {
    "scenarios": [
      {
        "scenarioName": "Standard 21k Option",
        "description": "A classic weight for a bridal set.",
        "karat": "21k",
        "weightG": 50,
        "makingCharges": 50000,
        "wastagePercentage": 10,
        "estimatedTotal": ... (calculated value)
      }
    ],
    "summaryText": "Here are three options for your bridal set, ranging from 45g to 55g."
  }
  `,
});

// --- Flow Definition ---
export const generateQuotationFlow = ai.defineFlow(
  {
    name: 'generateQuotationFlow',
    inputSchema: GenerateQuotationInputSchema,
    outputSchema: GenerateQuotationOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    if (!output) {
      throw new Error("AI failed to generate quotation options.");
    }
    return output;
  }
);
