revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

drop policy if exists "abuse_reports_insert_public" on public.abuse_reports;

create policy "abuse_reports_insert_public"
  on public.abuse_reports for insert
  to anon, authenticated
  with check (
    length(trim(hostname)) between 3 and 253
    and length(trim(reason)) between 1 and 2000
    and (url is null or length(trim(url)) <= 2048)
    and (reporter_email is null or length(trim(reporter_email)) <= 320)
    and status = 'open'
  );
