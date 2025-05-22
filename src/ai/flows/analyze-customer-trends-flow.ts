
'use server';
/**
 * @fileOverview A customer trend analysis AI agent.
 *
 * - analyzeCustomerTrends - A function that analyzes customer purchase history.
 * - AnalyzeCustomerTrendsInput - The input type for the analyzeCustomerTrends function.
 * - AnalyzeCustomerTrendsOutput - The return type for the analyzeCustomerTrends function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Define Zod schema for individual items within an invoice for the flow
const FlowInvoiceItemSchema = z.object({
  sku: z.string().describe('Stock Keeping Unit of the product.'),
  name: z.string().describe('Name of the product. This name often includes the category, e.g., "Rings - RIN-001".'),
  quantity: z.number().describe('Quantity of this item purchased.'),
  unitPrice: z.number().describe('Unit price of the item at the time of purchase.'),
  itemTotal: z.number().describe('Total price for this line item (unitPrice * quantity).'),
});

// Define Zod schema for an invoice for the flow
const FlowInvoiceSchema = z.object({
  id: z.string().describe('Unique identifier for the invoice.'),
  createdAt: z.string().describe('ISO date string of when the invoice was created.'),
  items: z.array(FlowInvoiceItemSchema).describe('List of items in the invoice.'),
  grandTotal: z.number().describe('The final total amount of the invoice after discounts.'),
});

// Define Zod schema for the input of the customer trends analysis flow
const AnalyzeCustomerTrendsInputSchema = z.object({
  customerId: z.string().describe('Unique identifier for the customer.'),
  customerName: z.string().describe('Name of the customer.'),
  invoices: z.array(FlowInvoiceSchema).describe("A list of the customer's past invoices."),
});
export type AnalyzeCustomerTrendsInput = z.infer<typeof AnalyzeCustomerTrendsInputSchema>;

// Define Zod schema for the output of the customer trends analysis flow
const AnalyzeCustomerTrendsOutputSchema = z.object({
  summary: z.string().describe("A brief overall summary of the customer's buying habits, preferences, and potential loyalty."),
  preferredCategories: z.array(z.string()).describe("List of product categories the customer frequently purchases. Extract categories from product names if possible (e.g., 'Rings' from 'Rings - XYZ')."),
  purchaseFrequency: z.string().describe("An analysis of how often the customer makes purchases (e.g., 'Regularly, about once a month', 'Infrequent, yearly', 'Multiple purchases in a short period recently')."),
  averageTransactionValue: z.number().describe("The average amount (grand total) the customer spends per transaction/invoice."),
  potentialNextPurchase: z.string().describe("A suggestion for a product category or specific type of item the customer might be interested in next, based on their history and common jewelry purchasing patterns (e.g., if they bought a ring, maybe earrings of a similar style)."),
  lastPurchaseDate: z.string().optional().describe("The date of the customer's most recent purchase, if available from the invoices."),
});
export type AnalyzeCustomerTrendsOutput = z.infer<typeof AnalyzeCustomerTrendsOutputSchema>;


export async function analyzeCustomerTrends(input: AnalyzeCustomerTrendsInput): Promise<AnalyzeCustomerTrendsOutput> {
  // Handle case with no invoices gracefully before calling the flow
  if (input.invoices.length === 0) {
    return {
      summary: "No transaction history available to analyze.",
      preferredCategories: [],
      purchaseFrequency: "N/A - No transactions",
      averageTransactionValue: 0,
      potentialNextPurchase: "N/A - No transaction history",
      lastPurchaseDate: undefined,
    };
  }
  return analyzeCustomerTrendsFlowInternal(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeCustomerTrendsPrompt',
  input: { schema: AnalyzeCustomerTrendsInputSchema },
  output: { schema: AnalyzeCustomerTrendsOutputSchema },
  prompt: `You are an expert sales analyst for a luxury jewelry store. Your task is to analyze a customer's purchase history and provide insights into their buying behavior and preferences.

Customer Information:
Name: {{{customerName}}}
Customer ID: {{{customerId}}}

Transaction History:
{{#if invoices.length}}
{{#each invoices}}
Invoice ID: {{this.id}}
Date: {{this.createdAt}}
Grand Total: PKR {{this.grandTotal}}
Items Purchased:
{{#each this.items}}
  - Product: "{{this.name}}" (Quantity: {{this.quantity}}, Item Total: PKR {{this.itemTotal}})
{{/each}}
-------------------------
{{/each}}
{{else}}
No transaction history available for this customer.
{{/if}}

Based ONLY on the provided transaction history, provide the following analysis. Ensure your response is in JSON format matching the defined output schema.

Key areas for analysis:
1.  **Summary**: Provide a concise summary of the customer's buying habits. Consider aspects like frequency, value, and type of items.
2.  **Preferred Categories**: Identify the main product categories. Product names often start with the category (e.g., "Rings - ...", "Necklaces - ...", "Earrings - ..."). List the distinct categories observed.
3.  **Purchase Frequency**: Analyze the dates of the invoices to describe how often the customer makes purchases. For example, "Regularly, approximately every X months," "Sporadic purchases," or "Multiple purchases clustered around specific dates."
4.  **Average Transaction Value**: Calculate the average grand total of their invoices.
5.  **Potential Next Purchase**: Based on their past purchases and common jewelry buying patterns (e.g., buying matching sets, anniversary gifts), suggest a product category or type they might be interested in for their next purchase.
6.  **Last Purchase Date**: Identify the date of their most recent transaction.

If there is no transaction history, the output fields should reflect that (e.g., "N/A", empty arrays, 0 for average value).
Focus on deriving insights directly from the provided data. Do not invent information not present in the transaction history.
`,
});

const analyzeCustomerTrendsFlowInternal = ai.defineFlow(
  {
    name: 'analyzeCustomerTrendsFlowInternal',
    inputSchema: AnalyzeCustomerTrendsInputSchema,
    outputSchema: AnalyzeCustomerTrendsOutputSchema,
  },
  async (input) => {
    // If there are no invoices, we might return a default "no data" response
    // This is now handled in the wrapper function `analyzeCustomerTrends`
    // if (input.invoices.length === 0) {
    //   return {
    //     summary: "No transaction history available for analysis.",
    //     preferredCategories: [],
    //     purchaseFrequency: "N/A",
    //     averageTransactionValue: 0,
    //     potentialNextPurchase: "N/A",
    //     lastPurchaseDate: undefined,
    //   };
    // }

    const { output } = await prompt(input);
    if (!output) {
      throw new Error("AI failed to generate an analysis.");
    }
    return output;
  }
);

