#!/usr/bin/env bash
# Is this a work branch that was cut from staging and carries only its own ticket?
#
#   check-work-branch.sh <branch-name> <tip> [<staging-ref>]
#
# Shared by .githooks/pre-push (before a branch leaves the machine) and the
# branch-policy workflow (before a PR can merge), so the two can never disagree.
#
# Git records no "branched from", so ancestry is read from what the branch
# contains, relative to staging:
#
#   1. The name is <feature|fix|chore|hotfix>/<PREFIX>-<n>-<slug>.
#   2. No commit on it is stamped for a different ticket. prepare-commit-msg
#      stamps every commit "Plane: <PREFIX>-<n>" from the branch name, so a
#      branch cut from ASTERION-7's branch carries ASTERION-7's stamps.
#   3. Every merge on it merges staging (catching up), never another branch.
#   4. It shares no commit with another open work branch unless that commit is
#      stamped for this ticket. Catches stacking on unstamped history, too.
#      (If another branch was cut from *this* one, the shared commits are ours,
#      so this branch still passes and that one fails.)
set -euo pipefail

name=${1:?branch name}
tip=${2:?tip commit}
base=${3:-origin/staging}

re='^(feature|fix|chore|hotfix)/([A-Z][A-Z0-9]*-[0-9]+)-[a-z0-9][a-z0-9-]*$'

fail() {
    printf 'branch-policy: %s\n' "$1" >&2
    printf 'branch-policy: work branches are cut from %s:  git switch --no-track -c <type>/<TICKET>-<slug> %s\n' "$base" "$base" >&2
    exit 1
}

[[ $name =~ $re ]] || fail "'$name' is not a work branch name (<feature|fix|chore|hotfix>/<TICKET>-<n>-<slug>)."
ticket=${BASH_REMATCH[2]}

git rev-parse -q --verify "$base^{commit}" >/dev/null || fail "cannot resolve $base (run: git fetch origin)."
git rev-parse -q --verify "$tip^{commit}" >/dev/null || fail "cannot resolve $tip."

range="$base..$tip"

stamp_of() { git log -1 --format='%(trailers:key=Plane,valueonly,separator=%x20)' "$1" | tr -d '[:space:]'; }

# 2. Commits stamped for another ticket.
for c in $(git rev-list "$range"); do
    s=$(stamp_of "$c")
    if [[ -n $s && $s != "$ticket" ]]; then
        fail "commit $(git log -1 --format='%h %s' "$c") belongs to $s, not $ticket. This branch contains another ticket's work, so it was probably cut from that ticket's branch."
    fi
done

# 3. Merges of anything but staging.
for m in $(git rev-list --merges "$range"); do
    for p in $(git rev-list --parents -n1 "$m" | cut -d' ' -f3-); do
        git merge-base --is-ancestor "$p" "$base" ||
            fail "merge $(git log -1 --format='%h' "$m") brings in $(git log -1 --format='%h %s' "$p"), which is not on $base. Only merge (or rebase onto) $base."
    done
done

# 4. History shared with another open work branch.
ours=$(git rev-list "$range" | sort)
if [[ -n $ours ]]; then
    for r in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin); do
        other=${r#origin/}
        [[ $other == "$name" || ! $other =~ $re ]] && continue
        for c in $(comm -12 <(printf '%s\n' "$ours") <(git rev-list "$base..$r" | sort)); do
            [[ $(stamp_of "$c") == "$ticket" ]] && continue
            fail "commit $(git log -1 --format='%h %s' "$c") is also on $other. This branch was cut from (or merged) another ticket's branch."
        done
    done
fi

echo "branch-policy: $name OK (cut from $base, $(git rev-list --count "$range") commit(s), all $ticket)"
