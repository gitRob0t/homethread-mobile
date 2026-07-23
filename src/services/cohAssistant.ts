import { supabase } from '../lib/supabase';

export type CohDraft = {
  title: string | null;
  person: string | null;
  date: string | null;
  time: string | null;
  location: string | null;
  reminder_minutes: number | null;
  directions: boolean | null;
  notes: string | null;
  grocery_items: Array<{
    name: string;
    quantity: string | null;
    category: string | null;
  }>;
  meals: Array<{
    date: string;
    meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    title: string;
    notes: string | null;
  }>;
};

export type CohResponse = {
  conversationId: string | null;
  reply: string;
  intent: 'event' | 'chore' | 'note' | 'grocery' | 'meal' | 'travel' | 'restaurant' | 'question' | 'none';
  status: 'collecting' | 'ready_for_confirmation' | 'confirmed' | 'canceled' | 'answered';
  missing_fields: string[];
  draft: CohDraft;
  proposed_action: {
    type: 'create_event' | 'create_chore' | 'create_note' | 'add_grocery_items' | 'create_meal_plan' | 'none';
    requires_confirmation: boolean;
  };
};

export type CohHistoryItem = { role: 'user' | 'assistant'; content: string };

export async function askCoh(input: {
  message: string;
  conversationId?: string | null;
  householdId?: string | null;
  timezone: string;
  history: CohHistoryItem[];
}): Promise<CohResponse> {
  const { data, error } = await supabase.functions.invoke<CohResponse>('coh-assistant', {
    body: input,
  });

  if (error) throw error;
  if (!data?.reply) throw new Error('Coh returned an invalid response.');
  return data;
}
