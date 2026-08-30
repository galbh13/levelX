import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

export const SUPABASE_URL = 'https://wrqhlwprevvcepjrbrea.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndycWhsd3ByZXZ2Y2VwanJicmVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2Mzc4MzgsImV4cCI6MjA5MTIxMzgzOH0.ac3pQJA8p5EoxUotHy8El4GcsVdyD-P4bSz-JOu3tFM';

const options = Platform.OS === 'web'
  ? {}
  : {
      auth: {
        storage: require('@react-native-async-storage/async-storage').default,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);