#!/usr/bin/perl
# Downloads every trail-type way (footway/path/track/bridleway/steps) in the
# Marin/Mt Tamalpais area — named or not — from OpenStreetMap via the
# Overpass API, caching the raw result to .cache/osm-network-raw.json for
# build-trail-network.pl to thin down into data/trail-network.js.
#
# This is broader than fetch-osm-extract.pl's cache (which only pulls
# *named* ways, for the 8 curated trails' real geometry): drag-to-trace
# snapping is useful on any trail, named or not, so this one drops the name
# requirement. It also intentionally excludes roads — an unfiltered query
# over this bbox returned 14,149 ways, and 5,521 of them were "service"
# roads (driveways, parking-lot lanes), which would bloat the snap network
# without helping a hiking app.
#
#   perl scripts/fetch-network-extract.pl
use strict;
use warnings;

my @BBOX = (37.84, -122.70, 37.98, -122.49);

my $query = "[out:json][timeout:180];" .
  "(way[\"highway\"~\"^(path|footway|track|bridleway|steps)\$\"]" .
  "($BBOX[0],$BBOX[1],$BBOX[2],$BBOX[3]););" .
  "out geom;";

print STDERR "Querying Overpass for all trail-type ways (named or not) in $BBOX[0],$BBOX[1] to $BBOX[2],$BBOX[3]...\n";
open(my $fh, '>', '.cache/_network_query.tmp') or die $!;
print $fh $query;
close $fh;
my $body = `curl -s --data-urlencode "data\@.cache/_network_query.tmp" 'https://overpass-api.de/api/interpreter'`;
unlink '.cache/_network_query.tmp';

mkdir '.cache' unless -d '.cache';
open(my $out, '>', '.cache/osm-network-raw.json') or die "Can't write .cache/osm-network-raw.json: $!";
print $out $body;
close $out;

print STDERR "Cached to .cache/osm-network-raw.json — now run: perl scripts/build-trail-network.pl\n";
