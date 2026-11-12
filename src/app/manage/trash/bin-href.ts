// URL of a folder inside a share's SRM recycle bin page (shared by server and client code).
export function binHref(share: string, parts: string[] = []) {
  return "/manage/trash/bin/" + [share, ...parts].map(encodeURIComponent).join("/");
}
