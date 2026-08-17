import type { Player } from "../types/game";
import rawAgents from "../../free_agents_output.json";

export const FREE_AGENTS: Player[] = rawAgents as Player[];
