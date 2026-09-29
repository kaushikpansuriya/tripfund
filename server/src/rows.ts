/** Database row types and their JSON (camelCase) representations. */

export interface TripRow {
  id: string;
  created_by: string;
  name: string;
  destination: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  currency: string;
  fund_holder_member_id: string | null;
  member_edit_policy: 'own' | 'none';
  created_at: Date;
  updated_at: Date;
}

export interface MemberRow {
  id: string;
  trip_id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  role: 'owner' | 'member';
  status: 'active' | 'left';
  joined_on: string | null;
  left_on: string | null;
  created_at: Date;
}

export interface CategoryRow {
  id: string;
  trip_id: string | null;
  name: string;
  icon: string | null;
  sort_order: number;
}

export interface ContributionRow {
  id: string;
  trip_id: string;
  member_id: string;
  received_by_member_id: string;
  amount: number;
  contributed_on: string;
  payment_method: string;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ExpenseRow {
  id: string;
  trip_id: string;
  kind: 'expense' | 'refund';
  title: string;
  category_id: string | null;
  amount: number;
  paid_by_member_id: string;
  split_method: 'equal' | 'exact' | 'percentage' | 'shares';
  spent_on: string;
  spent_at: string | null;
  location: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ParticipantRow {
  expense_id: string;
  member_id: string;
  split_value: number | null;
  share_amount: number;
  position: number;
}

export interface SettlementRow {
  id: string;
  trip_id: string;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  paid_on: string;
  payment_method: string;
  note: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export const tripJson = (t: TripRow) => ({
  id: t.id,
  name: t.name,
  destination: t.destination,
  description: t.description,
  startDate: t.start_date,
  endDate: t.end_date,
  currency: t.currency,
  fundHolderMemberId: t.fund_holder_member_id,
  memberEditPolicy: t.member_edit_policy,
  createdBy: t.created_by,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
});

export const memberJson = (m: MemberRow) => ({
  id: m.id,
  userId: m.user_id,
  name: m.name,
  email: m.email,
  role: m.role,
  status: m.status,
  joinedOn: m.joined_on,
  leftOn: m.left_on,
  hasAccount: m.user_id !== null,
});

export const categoryJson = (c: CategoryRow) => ({
  id: c.id,
  name: c.name,
  icon: c.icon,
  isCustom: c.trip_id !== null,
});

export const contributionJson = (c: ContributionRow) => ({
  id: c.id,
  memberId: c.member_id,
  receivedByMemberId: c.received_by_member_id,
  amount: c.amount,
  date: c.contributed_on,
  paymentMethod: c.payment_method,
  notes: c.notes,
  createdBy: c.created_by,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});

export const expenseJson = (e: ExpenseRow, participants: ParticipantRow[]) => ({
  id: e.id,
  kind: e.kind,
  title: e.title,
  categoryId: e.category_id,
  amount: e.amount,
  paidByMemberId: e.paid_by_member_id,
  splitMethod: e.split_method,
  date: e.spent_on,
  time: e.spent_at ? e.spent_at.slice(0, 5) : null,
  location: e.location,
  notes: e.notes,
  participants: participants
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((p) => ({ memberId: p.member_id, value: p.split_value, share: p.share_amount })),
  createdBy: e.created_by,
  createdAt: e.created_at,
  updatedAt: e.updated_at,
});

export const settlementJson = (s: SettlementRow) => ({
  id: s.id,
  fromMemberId: s.from_member_id,
  toMemberId: s.to_member_id,
  amount: s.amount,
  date: s.paid_on,
  paymentMethod: s.payment_method,
  note: s.note,
  createdBy: s.created_by,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
});
