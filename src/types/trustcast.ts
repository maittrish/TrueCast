export type ActiveView = 'auth' | 'ballot' | 'dashboard';

export type BoothStatus = 'OPEN' | 'SEALED';

export interface CandidateStanding {
  candidate_id: number;
  full_name: string;
  coalition: string;
  portfolio_focus: string;
  platform_summary: string;
  portrait_path: string;
  display_order: number;
  vote_count: number;
  share_pct: number;
}

export interface DemographicTurnout {
  age_group: string;
  registered: number;
  voted: number;
  turnout_pct: number;
}

export interface ConstituencyTurnout {
  constituency: string;
  registered: number;
  voted: number;
  turnout_pct: number;
}

export interface ConstituencyMatrixCell {
  constituency: string;
  age_group: string;
  registered: number;
  voted: number;
  turnout_pct: number;
}

export interface ResultsPayload {
  success: boolean;
  booth_status: BoothStatus;
  election_title: string;
  generated_at_ist: string;
  turnout: {
    total_registered: number;
    total_cast: number;
    turnout_pct: number;
  };
  candidates: CandidateStanding[];
  demographics: DemographicTurnout[];
  constituencies: ConstituencyTurnout[];
  constituency_matrix?: ConstituencyMatrixCell[];
}

export interface VotingSession {
  session_token: string;
  csrf_token: string;
  expires_at_unix: number;
  constituency: string;
}

export interface VoteReceipt {
  receipt_hash: string;
  cast_bucket_ist: string;
}

export interface OfficerSession {
  officer_token: string;
  officer_id: string;
  officer_name: string;
}

export interface OfficerVoterEntry {
  epic_id: string;
  full_name: string;
  age_group: string;
  constituency: string;
  mobile_masked: string;
  has_voted: boolean;
  voted_day: string | null;
}

export interface OfficerOverviewPayload {
  success: boolean;
  booth_status: BoothStatus;
  voters: OfficerVoterEntry[];
  constituencies: ConstituencyTurnout[];
  turnout: {
    total_registered: number;
    total_cast: number;
    turnout_pct: number;
  };
}
