import { supabase } from '../lib/supabase';

export type MoreMenuPreferences = {
  order: string[];
  hidden: string[];
};

export async function loadMoreMenuPreferences(userId: string) {
  const { data, error } = await supabase
    .from('member_ui_preferences')
    .select('more_menu_order, more_menu_hidden')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    order: Array.isArray(data.more_menu_order) ? data.more_menu_order : [],
    hidden: Array.isArray(data.more_menu_hidden) ? data.more_menu_hidden : [],
  } as MoreMenuPreferences;
}

export async function saveMoreMenuPreferences(
  userId: string,
  preferences: MoreMenuPreferences,
) {
  const { error } = await supabase
    .from('member_ui_preferences')
    .upsert({
      user_id: userId,
      more_menu_order: preferences.order,
      more_menu_hidden: preferences.hidden,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) throw error;
}
