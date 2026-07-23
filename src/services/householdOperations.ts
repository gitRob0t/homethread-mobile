import { supabase } from '../lib/supabase';

export type GroceryItem = {
  id: string;
  name: string;
  quantity: string | null;
  category: string;
  checked: boolean;
  created_at: string;
};

export type MealPlan = {
  id: string;
  meal_date: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  title: string;
  notes: string | null;
  recipe_url: string | null;
};

export type TravelSpace = {
  id: string;
  title: string;
  destination: string | null;
  starts_on: string | null;
  ends_on: string | null;
  created_by: string;
};

export type TravelEvent = {
  id: string;
  travel_space_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  reservation_url: string | null;
};

export function subscribeToOperations(
  table: 'grocery_items' | 'meal_plans' | 'travel_events',
  filter: { column: 'household_id' | 'travel_space_id'; value: string },
  onChange: () => void,
) {
  const channel = supabase
    .channel(`${table}:${filter.value}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: `${filter.column}=eq.${filter.value}`,
      },
      onChange,
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}

export async function listGroceries(householdId: string) {
  const { data, error } = await supabase
    .from('grocery_items')
    .select('id, name, quantity, category, checked, created_at')
    .eq('household_id', householdId)
    .order('checked', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as GroceryItem[];
}

export async function addGroceryItems(input: {
  householdId: string;
  userId: string;
  items: Array<{ name: string; quantity?: string | null; category?: string | null }>;
}) {
  const rows = input.items
    .map((item) => ({
      household_id: input.householdId,
      added_by: input.userId,
      name: item.name.trim(),
      quantity: item.quantity?.trim() || null,
      category: item.category?.trim() || 'Other',
    }))
    .filter((item) => item.name);
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('grocery_items')
    .insert(rows)
    .select('id');
  if (error) throw error;
  return data ?? [];
}

export async function setGroceryChecked(
  itemId: string,
  checked: boolean,
  userId: string,
) {
  const { error } = await supabase
    .from('grocery_items')
    .update({
      checked,
      checked_by: checked ? userId : null,
      checked_at: checked ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId);
  if (error) throw error;
}

export async function removeGroceryItem(itemId: string) {
  const { error } = await supabase.from('grocery_items').delete().eq('id', itemId);
  if (error) throw error;
}

export async function createInstacartShoppingLink(householdId: string) {
  const { data, error } = await supabase.functions.invoke<{
    url?: string;
    itemCount?: number;
    error?: string;
    code?: string;
  }>('instacart-shopping-list', {
    body: { householdId },
  });
  if (error) {
    const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    const payload = await context?.json?.().catch(() => undefined);
    throw new Error(payload?.error || error.message || 'The Instacart shopping link could not be created.');
  }
  if (!data?.url) throw new Error(data?.error || 'Instacart did not return a shopping link.');
  return { url: data.url, itemCount: data.itemCount ?? 0 };
}

export async function listMealPlans(householdId: string, startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('meal_plans')
    .select('id, meal_date, meal_type, title, notes, recipe_url')
    .eq('household_id', householdId)
    .gte('meal_date', startDate)
    .lte('meal_date', endDate)
    .order('meal_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MealPlan[];
}

export async function upsertMealPlans(input: {
  householdId: string;
  userId: string;
  meals: Array<{
    date: string;
    mealType?: MealPlan['meal_type'];
    title: string;
    notes?: string | null;
    recipeUrl?: string | null;
  }>;
}) {
  const rows = input.meals.map((meal) => ({
    household_id: input.householdId,
    meal_date: meal.date,
    meal_type: meal.mealType ?? 'dinner',
    title: meal.title.trim(),
    notes: meal.notes?.trim() || null,
    recipe_url: meal.recipeUrl?.trim() || null,
    created_by: input.userId,
    updated_by: input.userId,
    updated_at: new Date().toISOString(),
  })).filter((meal) => meal.title);
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('meal_plans')
    .upsert(rows, { onConflict: 'household_id,meal_date,meal_type' })
    .select('id');
  if (error) throw error;
  return data ?? [];
}

export async function listTravelSpaces() {
  const { data, error } = await supabase
    .from('travel_spaces')
    .select('id, title, destination, starts_on, ends_on, created_by')
    .order('starts_on', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as TravelSpace[];
}

export async function createTravelSpace(input: {
  title: string;
  destination?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
}) {
  const { data, error } = await supabase.rpc('create_travel_space', {
    space_title: input.title.trim(),
    space_destination: input.destination?.trim() || null,
    space_starts_on: input.startsOn || null,
    space_ends_on: input.endsOn || null,
  });
  if (error) throw error;
  return data as string;
}

export async function listTravelEvents(travelSpaceId: string) {
  const { data, error } = await supabase
    .from('travel_events')
    .select('id, travel_space_id, title, starts_at, ends_at, location, notes, reservation_url')
    .eq('travel_space_id', travelSpaceId)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TravelEvent[];
}

export async function addTravelEvent(input: {
  travelSpaceId: string;
  userId: string;
  title: string;
  startsAt: string;
  location?: string | null;
  notes?: string | null;
  reservationUrl?: string | null;
}) {
  const { data, error } = await supabase
    .from('travel_events')
    .insert({
      travel_space_id: input.travelSpaceId,
      created_by: input.userId,
      title: input.title.trim(),
      starts_at: input.startsAt,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      reservation_url: input.reservationUrl?.trim() || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function createTravelInvitation(
  travelSpaceId: string,
  email: string,
  role: 'planner' | 'guest' = 'guest',
) {
  const { data, error } = await supabase.rpc('create_travel_space_invitation', {
    target_space: travelSpaceId,
    target_email: email.trim().toLowerCase(),
    target_role: role,
  });
  if (error) throw error;
  return data?.[0] as { invitation_id: string; invitation_token: string } | undefined;
}

export async function acceptTravelInvitation(token: string) {
  const { data, error } = await supabase.rpc('accept_travel_space_invitation', {
    raw_token: token,
  });
  if (error) throw error;
  return data as string;
}
