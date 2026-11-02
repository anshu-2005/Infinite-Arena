# 2048
A small clone of [1024](https://play.google.com/store/apps/details?id=com.veewo.a1024), based on [Saming's 2048](http://saming.fr/p/2048/) (also a clone). 2048 was indirectly inspired by [Threes](https://asherv.com/threes/).

Made just for fun. [Play it here!](http://gabrielecirulli.github.io/2048/)

## Infinite Arena

This version wraps the original keyboard, swipe, merge, and scoring logic in a
responsive 6×6 competitive interface. Reaching 2048 unlocks an achievement but
does not stop a run; runs end when no moves remain. Infinite, Classic, Timed,
and Daily modes are available. Undo is supported, but using it marks a ranked
run as local-only.

Without Supabase credentials the game works offline with a local sample
leaderboard. Configure Supabase to enable passwordless sign-in, verified score
submissions, and realtime global rankings.

### Run locally

Serve this folder over HTTP (the authentication redirect and Supabase client
require an origin):

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`.

### Supabase setup

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql)
   in the SQL Editor.
2. Set `supabaseUrl` and `supabaseAnonKey` in [`js/config.js`](js/config.js).
   The anon/publishable key is public browser configuration; never put the
   service-role key in this file.
3. Configure Supabase Auth email sign-in and add the local and production app
   origins to the allowed redirect URLs.
4. Deploy the `start-game` and `submit-score` Edge Functions. Supabase supplies
   `SUPABASE_URL` and `SUPABASE_ANON_KEY`; configure
   `SUPABASE_SERVICE_ROLE_KEY` as an Edge Function secret if your project does
   not expose it automatically. The service-role key must remain server-side.
5. Confirm `public.scores` is enabled for Supabase Realtime. The schema attempts
   to add it to `supabase_realtime` when that publication exists.

The browser sends only an authenticated session ID, a move history, and a
claimed score. The Edge Function loads the server-created seed, replays all
moves, verifies the resulting score and game-end condition, and writes via a
service-only database function. Client-side score writes are denied by RLS.
This rejects arbitrary score edits; production deployments should also apply
Supabase Auth rate limits and monitor repeated session creation.

### Configuration values

| Location | Value | Secret |
| --- | --- | --- |
| `js/config.js` | `supabaseUrl` | No |
| `js/config.js` | `supabaseAnonKey` | No |
| Supabase Edge Function secrets | `SUPABASE_SERVICE_ROLE_KEY` | **Yes** |
| Supabase Edge Function environment | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | No |

For static hosting, set `window.INFINITE_ARENA_CONFIG` at runtime or populate
the tracked `js/config.js` values during deployment. Do not commit credentials.

### Tests

Run the browser-independent game logic and server replay tests with Node.js 24+:

```powershell
node --test tests/game_logic.test.js
```

The official app can also be found on the [Play Store](https://play.google.com/store/apps/details?id=com.gabrielecirulli.app2048) and [App Store!](https://itunes.apple.com/us/app/2048-by-gabriele-cirulli/id868076805)

### Contributions

[Anna Harren](https://github.com/iirelu/) and [sigod](https://github.com/sigod) are maintainers for this repository.

Other notable contributors:

 - [TimPetricola](https://github.com/TimPetricola) added best score storage
 - [chrisprice](https://github.com/chrisprice) added custom code for swipe handling on mobile
 - [marcingajda](https://github.com/marcingajda) made swipes work on Windows Phone
 - [mgarciaisaia](https://github.com/mgarciaisaia) added support for Android 2.3

Many thanks to [rayhaanj](https://github.com/rayhaanj), [Mechazawa](https://github.com/Mechazawa), [grant](https://github.com/grant), [remram44](https://github.com/remram44) and [ghoullier](https://github.com/ghoullier) for the many other good contributions.

### Screenshot

<p align="center">
  <img src="https://cloud.githubusercontent.com/assets/1175750/8614312/280e5dc2-26f1-11e5-9f1f-5891c3ca8b26.png" alt="Screenshot"/>
</p>

That screenshot is fake, by the way. I never reached 2048 :smile:

## Contributing
Changes and improvements are more than welcome! Feel free to fork and open a pull request. Please make your changes in a specific branch and request to pull into `master`! If you can, please make sure the game fully works before sending the PR, as that will help speed up the process.

You can find the same information in the [contributing guide.](https://github.com/gabrielecirulli/2048/blob/master/CONTRIBUTING.md)

## License
2048 is licensed under the [MIT license.](https://github.com/gabrielecirulli/2048/blob/master/LICENSE.txt)

## Donations
I made this in my spare time, and it's hosted on GitHub (which means I don't have any hosting costs), but if you enjoyed the game and feel like buying me coffee, you can donate at my BTC address: `1Ec6onfsQmoP9kkL3zkpB6c5sA4PVcXU2i`. Thank you very much!
