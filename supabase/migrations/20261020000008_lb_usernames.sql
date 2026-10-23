-- Optional User ID (username) for sign-in without an email address.
alter table lb_profiles add column username text
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,39}$');
create unique index lb_profiles_username on lb_profiles (username) where username is not null;
