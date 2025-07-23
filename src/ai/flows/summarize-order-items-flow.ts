
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
    summary: z.string().describe("A newline-separated list of item descriptions. Example: 'Custom bridal necklace\\nMatching earrings'"),
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
  prompt: `You are a data extractor. Your task is to extract the descriptions for a list of custom order items and list them, separated by newlines.

List of Items:
{{#each items}}
- {{this.description}}{{#if this.karat}} ({{this.karat}}){{/if}}{{#if this.estimatedWeightG}} - ~{{this.estimatedWeightG}}g{{/if}}
{{/each}}

Based on this list, extract only the descriptions and list each one on a new line.
For example, if the items are "Custom bridal necklace" and "Matching earrings", the summary should be:
"Custom bridal necklace
Matching earrings"
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

