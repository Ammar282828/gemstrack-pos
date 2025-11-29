
'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// --- Input Schema ---
const GenerateQuotationInputSchema = z.object({
  userRequest: z.string().describe("The user's spoken or written request for quotations. E.g., 'I want options for a 21k bridal set between 40 and 50 grams.'"),
  currentGoldRate24k: z.number().describe("Current gold rate for 24k per gram."),
  currentGoldRate22k: z.number().describe("Current gold rate for 22k per gram."),
  currentGoldRate21k: z.number().describe("Current gold rate for 21k per gram."),
  currentGoldRate18k: z.number().describe("Current gold rate for 18k per gram."),
});
export type GenerateQuotationInput = z.infer<typeof GenerateQuotationInputSchema>;

// --- Output Schema ---
const QuotationOptionSchema = z.object({
  optionName: z.string().describe("A short name for this option, e.g., 'Lowest Estimate' or 'Option A'."),
  description: z.string().optional().describe("Brief details about this specific option."),
  karat: z.enum(['18k', '21k', '22k', '24k']).describe("The karat used."),
  weightG: z.number().describe("The weight in grams."),
  makingCharges: z.number().describe("Estimated making charges."),
  wastagePercentage: z.number().describe("Wastage percentage applied."),
  stoneCharges: z.number().optional().describe("Charges for stones if applicable."),
  diamondCharges: z.number().optional().describe("Charges for diamonds if applicable."),
  miscCharges: z.number().optional().describe("Any other charges."),
  estimatedTotal: z.number().describe("The final calculated estimated price."),
});

const QuotationProductSchema = z.object({
  productName: z.string().describe("The name of the product, e.g. 'Bridal Set'."),
  description: z.string().optional().describe("General description of the product."),
  options: z.array(QuotationOptionSchema).describe("List of variations/options for this product."),
});

const GenerateQuotationOutputSchema = z.object({
  products: z.array(QuotationProductSchema).describe("A list of products with their quotation options. Empty if more info is needed."),
  summaryText: z.string().describe("A response to the user. If info is missing, ask for it here. If generated, summarize the result."),
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
  1. **Analyze the Request**: Identify the product(s), weight (or range), and karat.
  2. **Missing Information**: If the user request is vague (e.g., "How much is a ring?" with no weight or karat), **DO NOT** guess. 
     - Return an empty 'products' list.
     - Set 'summaryText' to politely ask for the specific details needed (e.g., "Could you please specify the estimated weight and karat for the ring?").
  3. **Structure**: Group options by Product.
  4. **Weight Ranges**: If a weight range is provided (e.g., "between 4-6g"), create exactly TWO options: "Lowest Estimate" (min weight) and "Highest Estimate" (max weight).
  5. **Variations**: If the user asks for "options" (e.g., "3 options for a set"), create distinct options (e.g. varying weights or karats).
  6. **Calculation**: Calculate prices using: (Weight * Rate) + (Weight * Rate * Wastage%) + Making + Stones/Diamonds.
     - Use the provided gold rates strictly.
     - Default Wastage: 10% if not specified.
     - Default Making: 3000 per gram if not specified.
  7. Return the result as a structured JSON.

  Example Output (Missing Info):
  {
    "products": [],
    "summaryText": "I can certainly give you a quote. What is the approximate weight and karat you are looking for?"
  }

  Example Output (Success):
  {
    "products": [
      {
        "productName": "Gold Ring",
        "options": [ ... ]
      }
    ],
    "summaryText": "Here are the estimates for your gold ring based on the current rates."
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
