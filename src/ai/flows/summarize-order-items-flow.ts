
'use server';
/**
 * @fileOverview An AI flow to summarize a list of custom order items.
 *
 * - summarizeOrderItems - A function that takes order items and returns a concise summary.
 * - SummarizeOrderItemsInput - The input type for the summarizeOrderItems function.
 * - SummarizeOrderItemsOutput - The return type for the summarizeOrderItems function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Define Zod schema for individual items for the summary flow
const FlowOrderItemSchema = z.object({
  description: z.string().describe('A brief description of the custom jewelry item.'),
  karat: z.string().optional().describe('The gold purity, e.g., "22k".'),
  estimatedWeightG: z.number().optional().describe('The estimated weight in grams.'),
});

const SummarizeOrderItemsInputSchema = z.object({
  items: z.array(FlowOrderItemSchema).describe('A list of custom order items.'),
});
export type SummarizeOrderItemsInput = z.infer<typeof SummarizeOrderItemsInputSchema>;

const SummarizeOrderItemsOutputSchema = z.object({
    summary: z.string().describe("A concise, single-sentence summary of all the items, suitable for a dashboard view. Example: 'A custom 22k bridal necklace and a pair of platinum wedding bands.'"),
});
export type SummarizeOrderItemsOutput = z.infer<typeof SummarizeOrderItemsOutputSchema>;


export async function summarizeOrderItems(input: SummarizeOrderItemsInput): Promise<SummarizeOrderItemsOutput> {
  if (input.items.length === 0) {
    return { summary: "No items in this order." };
  }
  return summarizeOrderItemsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'summarizeOrderItemsPrompt',
  input: { schema: SummarizeOrderItemsInputSchema },
  output: { schema: SummarizeOrderItemsOutputSchema },
  prompt: `You are a jewelry production manager. Your task is to create a very concise, single-sentence summary for a list of custom order items. This summary will be displayed on a dashboard, so it must be as brief and elegant as possible.

List of Items:
{{#each items}}
- {{this.description}}{{#if this.karat}} ({{this.karat}}){{/if}}{{#if this.estimatedWeightG}} - ~{{this.estimatedWeightG}}g{{/if}}
{{/each}}

Based on this list, generate the summary. Do not list the items again. Combine them into a natural-sounding sentence.
For example, if the items are "Custom bridal necklace" and "Matching earrings", the summary should be "A custom bridal necklace and matching earrings."
If there's only one item, just state what it is, e.g., "A platinum wedding band with custom engraving."
Make it as short as possible.
`,
});

const summarizeOrderItemsFlow = ai.defineFlow(
  {
    name: 'summarizeOrderItemsFlow',
    inputSchema: SummarizeOrderItemsInputSchema,
    outputSchema: SummarizeOrderItemsOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    if (!output) {
      throw new Error("AI failed to generate an order summary.");
    }
    return output;
  }
);
