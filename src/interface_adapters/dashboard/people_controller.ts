import { accountId, personId } from "../../entities/identity/ids";
import type { IssuePersonTokenOutputData } from "../../use_cases/issue_person_token/output_data";
import { ACCOUNTS_PAGE } from "./accounts_controller";
import { ADMIN } from "./admin_actor";
import { page, redirect, refused, type Outcome } from "./outcome";
import { runUseCase } from "./presenter";
import { setupPrompt, type PromptAccount } from "./setup_prompt";
import type { PeopleUseCases } from "./use_cases";

/** What Grok's connector form asks for (Settings → Connectors → custom MCP). */
export const CONNECTOR_NAME = "grokchat";

/**
 * The one-time token panel (GROKCHAT-16): the only view that ever holds a token. It is rendered
 * once, in the response to the POST that made the token, and nothing keeps it.
 */
export interface TokenView {
  readonly personName: string;
  readonly rotated: boolean;
  readonly token: string;
  readonly connectorName: string;
  readonly mcpUrl: string;
  /** The header value: `Bearer <token>`. */
  readonly authorization: string;
  readonly accounts: readonly PromptAccount[];
  /** The chief-of-staff prompt: the person's accounts, never the token. */
  readonly prompt: string;
}

type Result = { readonly ok: true } | { readonly ok: false; readonly code: string };

const done = (output: Result): Outcome<never> =>
  output.ok ? redirect(ACCOUNTS_PAGE) : refused(output.code);

function tokenView(output: IssuePersonTokenOutputData, origin: string): Outcome<TokenView> {
  if (!output.ok) {
    return refused(output.code);
  }
  const accounts = output.accounts.map((account) => ({ handle: account.handle, id: account.id }));
  const mcpUrl = `${origin}/mcp`;
  return page({
    personName: output.person.name,
    rotated: output.rotated,
    token: output.token,
    connectorName: CONNECTOR_NAME,
    mcpUrl,
    authorization: `Bearer ${output.token}`,
    accounts,
    prompt: setupPrompt({
      personName: output.person.name,
      accounts,
      mcpUrl,
      dashboardUrl: `${origin}/dashboard`,
    }),
  });
}

/** People on the accounts page (GROKCHAT-16): create, rename, delete, assign, issue a token. */
export class PeopleController {
  constructor(private readonly useCases: PeopleUseCases) {}

  create(name: string): Promise<Outcome<never>> {
    return runUseCase(this.useCases.createPerson, { actor: ADMIN, name }, done);
  }

  rename(id: string, name: string): Promise<Outcome<never>> {
    const input = { actor: ADMIN, personId: personId(id), name };
    return runUseCase(this.useCases.renamePerson, input, done);
  }

  remove(id: string, confirmation: string): Promise<Outcome<never>> {
    const input = { actor: ADMIN, personId: personId(id), confirmation };
    return runUseCase(this.useCases.deletePerson, input, done);
  }

  /** The Owner select: "" is Unassigned. */
  assign(account: string, owner: string): Promise<Outcome<never>> {
    const input = {
      actor: ADMIN,
      accountId: accountId(account),
      personId: owner === "" ? null : personId(owner),
    };
    return runUseCase(this.useCases.assignAccount, input, done);
  }

  token(id: string, origin: string): Promise<Outcome<TokenView>> {
    return runUseCase(
      this.useCases.issueToken,
      { actor: ADMIN, personId: personId(id) },
      (output) => tokenView(output, origin),
    );
  }
}
