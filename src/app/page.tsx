import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const role = user.user_metadata?.role
  if (['ADMIN', 'SUPER_ADMIN'].includes(role)) {
    redirect('/admin/dashboard')
  } else {
    redirect('/client/dashboard')
  }
}
