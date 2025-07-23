
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
    summary: z.string().describe("A very brief, single-sentence summary of the order. Example: 'A custom bridal necklace and matching earrings.'"),
});
export type SummarizeOrderItemsOutput = z.infer<typeof SummarizeOrderItemsOutputSchema>;


export async function summarizeOrderItems(input: SummarizeOrderItemsInput): Promise<SummarizeOrderItemsOutput> {
  if (input.items.length === 0) {
    return { summary: "No items in this order." };
  }
  
  // If only one item, just use its description
  if (input.items.length === 1 && input.items[0].description) {
      return { summary: input.items[0].description };
  }
  
  // For multiple items, use AI for a more natural summary
  return summarizeOrderItemsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'summarizeOrderItemsPrompt',
  input: { schema: SummarizeOrderItemsInputSchema },
  output: { schema: SummarizeOrderItemsOutputSchema },
  prompt: `You are an expert at creating concise summaries.
Your task is to summarize the following list of custom jewelry order items into a single, elegant sentence.
Do not use bullet points or newlines.

List of Items:
{{#each items}}
- {{this.description}}{{#if this.karat}} ({{this.karat}}){{/if}}{{#if this.estimatedWeightG}} - ~{{this.estimatedWeightG}}g{{/if}}
{{/each}}

Example summary for "Custom bridal necklace" and "Matching earrings": "A custom bridal necklace and matching earrings."
Example summary for multiple complex items: "A custom jewelry set including a necklace, earrings, and a ring."

Generate a single-sentence summary for the provided list.
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
    // Ensure no newlines in the final output
    return { summary: output.summary.replace(/\n/g, ' ') };
  }
);
