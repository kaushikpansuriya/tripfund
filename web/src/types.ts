/** Shapes returned by the API. */

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Trip {
  id: string;
  name: string;
  destination: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  currency: string;
  fundHolderMemberId: string | null;
  memberEditPolicy: 'own' | 'none';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TripListItem extends Trip {
  myRole: 'owner' | 'member';
  myMemberId: string;
  memberCount: number;
  totalExpenses: number;
  totalContributions: number;
}

export interface Member {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  role: 'owner' | 'member';
  status: 'active' | 'left';
  joinedOn: string | null;
  leftOn: string | null;
  hasAccount: boolean;
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  isCustom: boolean;
}

export interface TripDetail {
  trip: Trip;
  members: Member[];
  categories: Category[];
  me: { memberId: string; role: 'owner' | 'member'; isOwner: boolean };
}

export interface Contribution {
  id: string;
  memberId: string;
  receivedByMemberId: string;
  amount: number;
  date: string;
  paymentMethod: string;
  notes: string | null;
  createdBy: string | null;
  canEdit: boolean;
}

export type SplitMethod = 'equal' | 'exact' | 'percentage' | 'shares';

export interface Expense {
  id: string;
  kind: 'expense' | 'refund';
  title: string;
  categoryId: string | null;
  amount: number;
  paidByMemberId: string;
  splitMethod: SplitMethod;
  date: string;
  time: string | null;
  location: string | null;
  notes: string | null;
  participants: { memberId: string; value: number | null; share: number }[];
  createdBy: string | null;
  createdAt: string;
  canEdit: boolean;
}

export interface Settlement {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  date: string;
  paymentMethod: string;
  note: string | null;
  createdBy: string | null;
  canEdit: boolean;
}

export interface MemberBalance {
  memberId: string;
  name: string;
  contributed: number;
  fundHeld: number;
  paid: number;
  refundsReceived: number;
  expenseShare: number;
  refundShare: number;
  share: number;
  transfersSent: number;
  transfersReceived: number;
  net: number;
  status: 'receive' | 'pay' | 'settled';
  role: 'owner' | 'member';
  memberStatus: 'active' | 'left';
}

export interface SuggestedPayment {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
}

export interface Summary {
  trip: { id: string; name: string; currency: string; fundHolderMemberId: string | null };
  totals: {
    memberCount: number;
    contributions: number;
    expensesGross: number;
    refunds: number;
    expenses: number;
    fundRemaining: number;
    transfers: number;
    totalToReceive: number;
    totalOwed: number;
    expenseCount: number;
    refundCount: number;
    contributionCount: number;
    settlementCount: number;
  };
  members: MemberBalance[];
  settlement: SuggestedPayment[];
  byCategory: { categoryId: string | null; name: string; icon: string | null; amount: number }[];
  byDate: { date: string; amount: number }[];
  paidByMember: { memberId: string; name: string; amount: number }[];
  checks: { balancesSumToZero: boolean; sharesMatchExpenses: boolean; settlementClearsBalances: boolean; storedSharesMatch: boolean };
}

export interface NotificationItem {
  id: string;
  tripId: string;
  tripName: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  userName: string | null;
  action: 'create' | 'update' | 'delete';
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}
