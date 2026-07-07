const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:SUjqI8U0iPKMJs5H@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true"
    }
  }
})
async function main() {
  try {
    const apps = await prisma.onboardingApplication.count()
    console.log("Success! App count:", apps)
  } catch (e) {
    console.error("Error:", e.message)
  } finally {
    await prisma.$disconnect()
  }
}
main()
