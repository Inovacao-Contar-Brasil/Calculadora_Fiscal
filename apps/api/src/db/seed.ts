/**
 * Seed inicial: cria a organização gestora e o primeiro administrador a partir
 * de variáveis de ambiente (SEED_*). Idempotente: não duplica nem sobrescreve.
 * Nunca imprime a senha. Uso: `npm run db:seed` (lê apps/api/.env).
 */
import { eq, sql } from "drizzle-orm";
import { loadConfig } from "../config.ts";
import { hashPassword, validatePasswordPolicy } from "../auth/password.ts";
import { createDatabase, databaseOptionsFromEnv } from "./client.ts";
import { memberships, organizations, users } from "./schema.ts";

const env = process.env;
const orgName = env.SEED_ORGANIZATION_NAME ?? "Contar Brasil";
const orgSlug = env.SEED_ORGANIZATION_SLUG ?? "contar-brasil";
const adminEmail = env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const adminName = env.SEED_ADMIN_NAME ?? "Administrador";
const adminPassword = env.SEED_ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.error("Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD (ver .env.example).");
  process.exit(1);
}
const policyError = validatePasswordPolicy(adminPassword);
if (policyError) {
  console.error("Senha do seed rejeitada: " + policyError);
  process.exit(1);
}

const config = loadConfig();
const database = await createDatabase(databaseOptionsFromEnv(config));
await database.migrate();
const { db } = database;

let org = (await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1))[0];
if (!org) {
  [org] = await db.insert(organizations).values({ name: orgName, slug: orgSlug }).returning();
  console.log("Organização criada:", org!.name);
} else {
  console.log("Organização já existe:", org.name);
}

let admin = (await db.select().from(users).where(sql`lower(${users.email}) = ${adminEmail}`).limit(1))[0];
if (!admin) {
  [admin] = await db.insert(users).values({ email: adminEmail, name: adminName, passwordHash: await hashPassword(adminPassword) }).returning();
  console.log("Administrador criado:", admin!.email);
} else {
  console.log("Usuário já existe (senha não alterada):", admin.email);
}

const membership = await db
  .select()
  .from(memberships)
  .where(sql`${memberships.userId} = ${admin!.id} and ${memberships.organizationId} = ${org!.id}`)
  .limit(1);
if (!membership[0]) {
  await db.insert(memberships).values({ userId: admin!.id, organizationId: org!.id, role: "admin" });
  console.log("Papel admin atribuído.");
}

await database.close();
console.log("Seed concluído (" + database.kind + ").");
