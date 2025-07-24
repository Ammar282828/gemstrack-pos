
'use server';
/**
 * @fileOverview A flow to send a WhatsApp message via a third-party API (e.g., Twilio).
 *
 * This flow provides a secure backend endpoint to handle the sending of messages,
 * keeping API credentials safely on the server.
 *
 * - sendWhatsAppMessage - A function that takes a recipient's phone number and a message and sends it.
 * - SendWhatsAppMessageInput - The input type for the sendWhatsAppMessage function.
 * - SendWhatsAppMessageOutput - The return type for the sendWhatsAppMessage function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Define the input schema for our flow
export const SendWhatsAppMessageInputSchema = z.object({
  to: z.string().describe("The recipient's phone number in E.164 format (e.g., whatsapp:+15551234567)."),
  body: z.string().describe("The text content of the message to be sent."),
});
export type SendWhatsAppMessageInput = z.infer<typeof SendWhatsAppMessageInputSchema>;

// Define the output schema for our flow
export const SendWhatsAppMessageOutputSchema = z.object({
  success: z.boolean().describe("Whether the message was successfully queued for sending."),
  messageSid: z.string().optional().describe("The unique identifier for the message from the provider (e.g., Twilio's SID)."),
  error: z.string().optional().describe("Any error message if the sending failed."),
});
export type SendWhatsAppMessageOutput = z.infer<typeof SendWhatsAppMessageOutputSchema>;


// This is the main function you'll call from your frontend components.
export async function sendWhatsAppMessage(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageOutput> {
  return sendWhatsAppMessageFlow(input);
}


// This is the Genkit flow that defines the server-side logic.
const sendWhatsAppMessageFlow = ai.defineFlow(
  {
    name: 'sendWhatsAppMessageFlow',
    inputSchema: SendWhatsAppMessageInputSchema,
    outputSchema: SendWhatsAppMessageOutputSchema,
  },
  async (input) => {
    // IMPORTANT: Retrieve API credentials securely from environment variables.
    // These must be set in your .env or server environment.
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhoneNumber = process.env.TWILIO_WHATSAPP_FROM_NUMBER; // e.g., 'whatsapp:+14155238886'

    if (!accountSid || !authToken || !fromPhoneNumber) {
      console.error("Twilio credentials are not configured in environment variables.");
      return { success: false, error: "Server is not configured for sending messages." };
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    try {
      // Use the built-in 'fetch' API to make the request to Twilio.
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(accountSid + ':' + authToken),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: input.to,
          From: fromPhoneNumber,
          Body: input.body,
        }),
      });

      const responseData = await response.json();

      if (response.ok) {
        console.log("Message sent successfully via Twilio. SID:", responseData.sid);
        return { success: true, messageSid: responseData.sid };
      } else {
        console.error("Failed to send message via Twilio:", responseData);
        return { success: false, error: responseData.message || 'An unknown error occurred.' };
      }
    } catch (error) {
      console.error("Exception when trying to send message:", error);
      const errorMessage = error instanceof Error ? error.message : "A network or system error occurred.";
      return { success: false, error: errorMessage };
    }
  }
);
