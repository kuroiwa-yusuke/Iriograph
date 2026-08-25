#!/usr/bin/env bash
set -euo pipefail

: "${TARGET_COMMIT:?TARGET_COMMIT is required}"
: "${PACKAGE_VERSION:?PACKAGE_VERSION is required}"
: "${VERIFY_RESULT:?VERIFY_RESULT is required}"
: "${PUBLISH_RESULT:?PUBLISH_RESULT is required}"

if [[ ! "${TARGET_COMMIT}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid target commit" >&2
  exit 1
fi
if [[ ! "${PACKAGE_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid package version" >&2
  exit 1
fi
for job_result in "${VERIFY_RESULT}" "${PUBLISH_RESULT}"; do
  case "${job_result}" in
    success|failure|cancelled|skipped) ;;
    *)
      echo "Invalid workflow job result" >&2
      exit 1
      ;;
  esac
done

if [[ "${VERIFY_RESULT}" == "success" && "${PUBLISH_RESULT}" == "success" ]]; then
  OUTCOME="success"
  OPPOSITE="failure"
else
  OUTCOME="failure"
  OPPOSITE="success"
fi

RESULT_TAG="packages-publish-${OUTCOME}-${TARGET_COMMIT}"
OPPOSITE_TAG="packages-publish-${OPPOSITE}-${TARGET_COMMIT}"
DIAGNOSTIC_TAG="packages-publish-diagnostic-${TARGET_COMMIT}"
PUBLISHED_TAG="packages-published-v${PACKAGE_VERSION}"
DIAGNOSTIC_MESSAGE="$(printf \
  '{"schema":"iriograph-package-publish-diagnostic/v1","commit":"%s","version":"%s","outcome":"%s","jobs":{"verify":"%s","publish":"%s"}}' \
  "${TARGET_COMMIT}" "${PACKAGE_VERSION}" "${OUTCOME}" "${VERIFY_RESULT}" "${PUBLISH_RESULT}")"

remote_tag_commit() {
  local tag_name="$1"
  local refs
  refs="$(git ls-remote --refs origin "refs/tags/${tag_name}" || true)"
  if [[ -z "${refs}" ]]; then
    return 1
  fi
  git fetch --force --no-tags origin "refs/tags/${tag_name}" >/dev/null
  git rev-parse 'FETCH_HEAD^{}'
}

verify_remote_commit() {
  local tag_name="$1"
  local remote_commit
  remote_commit="$(remote_tag_commit "${tag_name}")" || return 1
  if [[ "${remote_commit}" != "${TARGET_COMMIT}" ]]; then
    echo "${tag_name} points to an unexpected commit" >&2
    return 2
  fi
}

ensure_lightweight_tag() {
  local tag_name="$1"
  if verify_remote_commit "${tag_name}"; then
    echo "${tag_name} already records this commit"
    return 0
  else
    local status="$?"
    if [[ "${status}" -eq 2 ]]; then return 1; fi
  fi

  git tag "${tag_name}" "${TARGET_COMMIT}"
  if git push origin "refs/tags/${tag_name}"; then
    return 0
  fi
  verify_remote_commit "${tag_name}"
}

verify_remote_diagnostic() {
  verify_remote_commit "${DIAGNOSTIC_TAG}" || return $?
  if [[ "$(git cat-file -t FETCH_HEAD)" != "tag" ]]; then
    echo "${DIAGNOSTIC_TAG} is not an annotated tag" >&2
    return 2
  fi
  local remote_message
  remote_message="$(git cat-file tag FETCH_HEAD | sed '1,/^$/d')"
  if [[ "${remote_message}" != "${DIAGNOSTIC_MESSAGE}" ]]; then
    echo "${DIAGNOSTIC_TAG} contains conflicting diagnostic data" >&2
    return 2
  fi
}

ensure_diagnostic_tag() {
  if verify_remote_diagnostic; then
    echo "${DIAGNOSTIC_TAG} already records this workflow result"
    return 0
  else
    local status="$?"
    if [[ "${status}" -eq 2 ]]; then return 1; fi
  fi

  git -c user.name="github-actions[bot]" \
    -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    tag -a "${DIAGNOSTIC_TAG}" "${TARGET_COMMIT}" -m "${DIAGNOSTIC_MESSAGE}"
  if git push origin "refs/tags/${DIAGNOSTIC_TAG}"; then
    return 0
  fi
  verify_remote_diagnostic
}

if verify_remote_commit "${OPPOSITE_TAG}"; then
  echo "Opposite immutable package publish result already exists" >&2
  exit 1
else
  opposite_status="$?"
  if [[ "${opposite_status}" -eq 2 ]]; then exit 1; fi
fi
if [[ "${OUTCOME}" == "success" ]]; then
  if verify_remote_commit "${PUBLISHED_TAG}"; then
    :
  else
    published_status="$?"
    if [[ "${published_status}" -eq 2 ]]; then exit 1; fi
  fi
fi

ensure_diagnostic_tag
ensure_lightweight_tag "${RESULT_TAG}"
if [[ "${OUTCOME}" == "success" ]]; then
  ensure_lightweight_tag "${PUBLISHED_TAG}"
fi
