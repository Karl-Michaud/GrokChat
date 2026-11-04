import { accountId, personId } from "../../entities/identity/ids";
import type { IssuePersonTokenOutputData } from "../../use_cases/issue_person_token/output_data";
import { ACCOUNTS_PAGE, tokenDate } from "./accounts_controller";
import { ADMIN } from "./admin_actor";
import { page, redirect, refused, type Outcome } from "./outcome";
import { runUseCase } from "./presenter";
import { setupPrompt, type PromptAccount } from "./setup_prompt";
import { issuedField, parseIssued } from "./token_form";
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

/** A re-sent token form: nothing changed; ask before rotating the token the person now has. */
export interface StaleTokenView {
  readonly personId: string;
  readonly personName: string;
  /** "Token set Oct 27, 2026", or "No token" */
  readonly current: string;
  /** The `issued` field for a deliberate rotate of the current token. */
  readonly issued: string;
}

export type TokenPanel =
  | { readonly kind: "issued"; readonly view: TokenView }
  | { readonly kind: "stale"; readonly view: StaleTokenView };

type Result = { readonly ok: true } | { readonly ok: false; readonly code: string };

const done = (output: Result): Outcome<never> =>
  output.ok ? redirect(ACCOUNTS_PAGE) : refused(output.code);

function tokenView(output: IssuePersonTokenOutputData, origin: string): Outcome<TokenPanel> {
  if (!output.ok) {
    if (output.code !== "token_already_issued") {
      return refused(output.code);
    }
    const token = output.person.token;
    return page({
      kind: "stale",
      view: {
        personId: output.person.id,
        personName: output.person.name,
        current: token === null ? "No token" : `Token set ${tokenDate(token.createdAt)}`,
        issued: issuedField(token?.createdAt ?? null),
      },
    });
  }
  const accounts = output.accounts.map((account) => ({ handle: account.handle, id: account.id }));
  const mcpUrl = `${origin}/mcp`;
  const view: TokenView = {
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
  };
  return page({ kind: "issued", view });
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

  /** `issued` is the form's field (`issuedField`): what the token was when the form was shown. */
  token(id: string, origin: string, issued: string): Promise<Outcome<TokenPanel>> {
    return runUseCase(
      this.useCases.issueToken,
      { actor: ADMIN, personId: personId(id), expected: parseIssued(issued) },
      (output) => tokenView(output, origin),
    );
  }
}
