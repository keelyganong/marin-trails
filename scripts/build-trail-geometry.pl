#!/usr/bin/perl
# Turns the cached OSM extract (.cache/osm-raw-ways.json, from
# fetch-osm-extract.pl) plus data/trail-sources.json into real stitched trail
# geometry, written to data/trails-geometry.json for merge-trail-data.pl.
#
# Each source trail is selected either by OSM way name ("mode": "name") or by
# an explicit list of way ids ("mode": "wayIds", for loops like Phoenix Lake
# that aren't covered by a single OSM name). Matched ways are stitched into
# one continuous path by greedily chaining whichever remaining way has an
# endpoint closest to the current path's tail, starting from a seed point
# near the real trailhead.
#
#   perl scripts/build-trail-geometry.pl
use strict;
use warnings;
use JSON::PP;

my $json = JSON::PP->new->utf8->canonical;

# Shells out to curl rather than LWP — this machine's Perl has no configured
# CA trust store for HTTPS, while curl (system-provided, uses the OS trust
# store) works fine.
sub curl_post {
  my ($url, $data) = @_;
  open(my $fh, '>', '.cache/_query.tmp') or die $!;
  print $fh $data;
  close $fh;
  my $out = `curl -s --data-urlencode "data\@.cache/_query.tmp" '$url'`;
  unlink '.cache/_query.tmp';
  return $out;
}

sub read_json_file {
  my ($path) = @_;
  open(my $fh, '<', $path) or die "Can't read $path: $!";
  local $/;
  return $json->decode(<$fh>);
}

sub haversine_miles {
  my ($a, $b) = @_;
  my $R = 3958.8;
  my $dlat = ($b->[0] - $a->[0]) * 3.14159265358979 / 180;
  my $dlon = ($b->[1] - $a->[1]) * 3.14159265358979 / 180;
  my $rlat1 = $a->[0] * 3.14159265358979 / 180;
  my $rlat2 = $b->[0] * 3.14159265358979 / 180;
  my $h = sin($dlat/2)**2 + cos($rlat1) * cos($rlat2) * sin($dlon/2)**2;
  return 2 * $R * atan2(sqrt($h), sqrt(1 - $h));
}

# Alias so the chaining code below reads as "distance for comparison" — uses
# true haversine miles throughout (a raw-degree distance would overestimate
# east-west gaps at this latitude, since a degree of longitude here is ~55mi
# vs ~69mi for a degree of latitude, and wrongly reject valid bridges).
sub dist2 { my ($a, $b) = @_; return haversine_miles($a, $b); }

sub path_miles {
  my ($path) = @_;
  my $total = 0;
  $total += haversine_miles($path->[$_-1], $path->[$_]) for 1 .. $#$path;
  return $total;
}

# Per-trail candidates are scoped by name + a local bbox (see
# data/trail-sources.json), so most remaining gaps between matched ways are
# real tagging gaps (an untagged connector, a road crossing) worth bridging
# rather than noise. But a bbox can still pull in a same-named segment that
# turns out to be a genuinely separate, disconnected stretch (seen with
# Cataract Trail's OSM tagging, which has a piece ~1.4mi away near Alpine
# Lake's far shore) — bridging that would draw a false straight line across
# the map. Stop the chain rather than bridge a gap this large.
my $SNAP_MILES = 1.0;

# Returns (path, \@gaps) where @gaps are the [miles, fromPoint, toPoint] jumps
# larger than "notable" (0.05mi) that got bridged, for manual review.
sub chain_ways {
  my ($ways, $seed) = @_;
  return ([], []) unless @$ways;
  my @remaining = @$ways;
  my @gaps;

  my ($startIdx, $startRev, $bestD) = (0, 0, undef);
  for my $i (0 .. $#remaining) {
    my ($d0, $d1) = (dist2($seed, $remaining[$i][0]), dist2($seed, $remaining[$i][-1]));
    if (!defined($bestD) || $d0 < $bestD) { $bestD = $d0; $startIdx = $i; $startRev = 0; }
    if ($d1 < $bestD) { $bestD = $d1; $startIdx = $i; $startRev = 1; }
  }
  my $first = splice(@remaining, $startIdx, 1);
  my @path = $startRev ? reverse(@$first) : @$first;

  while (@remaining) {
    my $tail = $path[-1];
    my ($bestI, $bestRev, $bd) = (-1, 0, undef);
    for my $i (0 .. $#remaining) {
      my ($d0, $d1) = (dist2($tail, $remaining[$i][0]), dist2($tail, $remaining[$i][-1]));
      if (!defined($bd) || $d0 < $bd) { $bd = $d0; $bestI = $i; $bestRev = 0; }
      if ($d1 < $bd) { $bd = $d1; $bestI = $i; $bestRev = 1; }
    }
    last if $bestI == -1;
    last if $bd > $SNAP_MILES;
    my $w = splice(@remaining, $bestI, 1);
    my @seg = $bestRev ? reverse(@$w) : @$w;
    my $gapMiles = haversine_miles($tail, $seg[0]);
    push @gaps, [$gapMiles, $tail, $seg[0]] if $gapMiles > 0.05;
    shift @seg;
    push @path, @seg;
  }
  return (\@path, \@gaps);
}

# For a hand-verified sequence of ways (confirmed connected via matching or
# near-matching endpoints), concatenate them in EXACTLY the given order,
# each auto-oriented to best continue the running path — unlike chain_ways,
# never reordering or skipping based on which candidate is nearest. Needed
# because at a real junction where 3+ ways meet, the nearest-endpoint greedy
# search can "steal" a connection that numerically looks closer but isn't
# the intended route (confirmed happening for yolanda-hidden-meadow, where
# it kept connecting Shaver Grade Road straight to Hidden Meadow Trail
# instead of continuing on to Diblee Road as intended).
# $reverses (optional, parallel to $ways) forces each way's direction
# explicitly instead of auto-picking whichever end looks closer — needed
# because at a junction with 3+ ways, "closer" for THIS connection can be
# the wrong choice for the NEXT one, silently producing a worse path.
# Verify explicit directions once by inspecting real endpoint coordinates
# (see the "comment" field in trail-sources.json for the ones this was
# needed for) rather than trusting auto-orientation's local guess.
sub chain_ordered {
  my ($ways, $seed, $reverses) = @_;
  return ([], []) unless @$ways;
  my @gaps;
  my $first = $ways->[0];
  my $firstRev = defined($reverses->[0]) ? $reverses->[0]
    : (haversine_miles($seed, $first->[-1]) < haversine_miles($seed, $first->[0]));
  my @path = $firstRev ? reverse(@$first) : @$first;
  for my $i (1 .. $#$ways) {
    my $way = $ways->[$i];
    my $tail = $path[-1];
    my $rev = defined($reverses->[$i]) ? $reverses->[$i]
      : (haversine_miles($tail, $way->[-1]) < haversine_miles($tail, $way->[0]));
    my @seg = $rev ? reverse(@$way) : @$way;
    my $gapMiles = haversine_miles($tail, $seg[0]);
    push @gaps, [$gapMiles, $tail, $seg[0]] if $gapMiles > 0.05;
    shift @seg;
    push @path, @seg;
  }
  return (\@path, \@gaps);
}

my $cache = read_json_file('.cache/osm-raw-ways.json');
my $sources = read_json_file('data/trail-sources.json');

sub fetch_ways_by_id {
  my (@ids) = @_;
  return {} unless @ids;
  my $idList = join(',', @ids);
  my $q = "[out:json][timeout:60];way(id:$idList);out tags geom;";
  print STDERR "  fetching " . scalar(@ids) . " way(s) by id not present in cache...\n";
  my $body = curl_post('https://overpass-api.de/api/interpreter', $q);
  my $data = $json->decode($body);
  my %byId;
  $byId{$_->{id}} = $_ for @{$data->{elements}};
  return \%byId;
}

my %cacheById;
$cacheById{$_->{id}} = $_ for @{$cache->{elements}};

my %results;
for my $t (@{$sources->{trails}}) {
  my $id = $t->{id};
  print STDERR "Building $id ($t->{name})...\n";

  my @matched;
  if ($t->{mode} eq 'name') {
    my $re = qr/$t->{nameRegex}/i;
    my ($s, $w, $n, $e) = @{$t->{bbox}};
    for my $el (values %cacheById) {
      next unless ($el->{tags}{name} // '') =~ $re;
      next unless defined $el->{tags}{name}; # be explicit
      my @geom = @{$el->{geometry}};
      next unless @geom;
      # keep only ways with at least one point inside the trail's bbox, to
      # avoid pulling in a same-named way elsewhere in the county
      next unless grep { $_->{lat} >= $s && $_->{lat} <= $n && $_->{lon} >= $w && $_->{lon} <= $e } @geom;
      if ($t->{surfaceRegex}) {
        my $surf = $el->{tags}{surface} // '';
        next unless $surf =~ /$t->{surfaceRegex}/i;
      }
      push @matched, $el;
    }
  } elsif ($t->{mode} eq 'wayIds' || $t->{mode} eq 'ordered') {
    my $idListKey = $t->{mode} eq 'ordered' ? 'orderedWayIds' : 'wayIds';
    my @missing = grep { !exists $cacheById{$_} } @{$t->{$idListKey}};
    my $fetched = fetch_ways_by_id(@missing);
    for my $wid (@{$t->{$idListKey}}) {
      my $el = $cacheById{$wid} // $fetched->{$wid};
      push @matched, $el if $el;
    }
  } else {
    die "Unknown mode for $id: $t->{mode}";
  }

  if (!@matched) {
    print STDERR "  ! no matching ways found\n";
    $results{$id} = { path => [], distanceMiles => 0, wayCount => 0, wayIds => [], status => 'not_found' };
    next;
  }

  my @geoms = map { [ map { [$_->{lat}, $_->{lon}] } @{$_->{geometry}} ] } @matched;
  my @wayIds = map { $_->{id} } @matched;
  my ($path, $gaps) = $t->{mode} eq 'ordered'
    ? chain_ordered(\@geoms, $t->{seed}, $t->{orderedReverses} || [])
    : chain_ways(\@geoms, $t->{seed});
  my $miles = path_miles($path);
  my $expected = $t->{expectedMiles};
  my $ratio = $expected ? $miles / $expected : 1;
  my $status = ($expected && ($ratio < 0.5 || $ratio > 2.0)) ? 'review' : 'ok';

  printf STDERR "  ways=%d points=%d miles=%.2f (expected ~%.1f) -> %s\n",
    scalar(@matched), scalar(@$path), $miles, $expected // 0, $status;
  for my $g (@$gaps) {
    printf STDERR "    bridged gap: %.2f mi at [%.5f,%.5f] -> [%.5f,%.5f]\n",
      $g->[0], @{$g->[1]}, @{$g->[2]};
  }

  $results{$id} = {
    path => $path,
    distanceMiles => $miles + 0,
    wayCount => scalar(@matched),
    wayIds => \@wayIds,
    bridgedGaps => scalar(@$gaps),
    status => $status,
  };
}

open(my $out, '>', 'data/trails-geometry.json') or die "Can't write data/trails-geometry.json: $!";
print $out JSON::PP->new->canonical->pretty->encode(\%results);
close $out;
print STDERR "Wrote data/trails-geometry.json\n";
