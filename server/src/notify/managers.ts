/**
 * Posts notification cards to the managers' Telegram group.
 * Tools and the agent depend only on this interface; the Telegram-backed
 * TelegramManagerNotifier implementation is added in Task 11 (same file).
 */
export interface ManagerNotifier {
  orderCard(orderId: number): Promise<void>
  escalationCard(escalationId: number): Promise<void>
}
