import { randomBytes } from "node:crypto"
import { type Invitation, invitations } from "@shared/schema"
import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { db } from "../db"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function newInviteToken(): string {
	return randomBytes(24).toString("base64url") // 32 chars URL-safe
}

export interface CreateInviteInput {
	email: string
	role: "viewer" | "admin"
	createdBy: string // app_users.id of the inviter
}

export async function createInvite(input: CreateInviteInput): Promise<Invitation> {
	const token = newInviteToken()
	const [row] = await db
		.insert(invitations)
		.values({
			email: input.email.toLowerCase(),
			role: input.role,
			token,
			expiresAt: new Date(Date.now() + INVITE_TTL_MS),
			createdBy: input.createdBy,
		})
		.returning()
	if (!row) throw new Error("invitation insert failed")
	return row
}

export async function findValidInvite(token: string): Promise<Invitation | null> {
	const [row] = await db
		.select()
		.from(invitations)
		.where(
			and(
				eq(invitations.token, token),
				isNull(invitations.consumedAt),
				gt(invitations.expiresAt, new Date()),
			),
		)
		.limit(1)
	return row ?? null
}

export async function consumeInvite(token: string, userId: string): Promise<Invitation | null> {
	const [row] = await db
		.update(invitations)
		.set({ consumedAt: new Date(), consumedUserId: userId })
		.where(
			and(
				eq(invitations.token, token),
				isNull(invitations.consumedAt),
				gt(invitations.expiresAt, new Date()),
			),
		)
		.returning()
	return row ?? null
}

export async function listPendingInvites(): Promise<Invitation[]> {
	return db
		.select()
		.from(invitations)
		.where(and(isNull(invitations.consumedAt), gt(invitations.expiresAt, new Date())))
		.orderBy(desc(invitations.createdAt))
}

export async function deleteInvite(id: string): Promise<void> {
	await db.delete(invitations).where(eq(invitations.id, id))
}
