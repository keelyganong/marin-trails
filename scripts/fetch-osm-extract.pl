#!/usr/bin/perl
# Downloads every named hiking-type way (path/footway/track/bridleway/steps)
# in the Marin/Mt Tamalpais area from OpenStreetMap via the Overpass API, and
# caches the raw result to .cache/osm-raw-ways.json.
#
# This is a single broad fetch rather than one query per trail — kinder to
# the shared Overpass instance, and it lets build-trail-geometry.pl select
# and restitch segments locally without hitting the network again.
#
# Rerun when OSM coverage may have changed:
#   perl scripts/fetch-osm-extract.pl
use strict;
use warnings;
use JSON::PP;
use LWP::UserAgent;

# South, west, north, east — covers Mt Tam State Park, Muir Woods, the GGNRA
# headlands, and the MMWD watershed lands where all our trailheads sit.
my @BBOX = (37.84, -122.70, 37.98, -122.49);

my $ua = LWP::UserAgent->new(timeout => 180);
$ua->agent('marin-trails-geometry-fetch/1.0 (personal project, contact: kganong@umich.edu)');

my $query = "[out:json][timeout:180];" .
  "(way[\"highway\"~\"^(path|footway|track|bridleway|steps)\$\"][\"name\"]" .
  "($BBOX[0],$BBOX[1],$BBOX[2],$BBOX[3]););" .
  "out tags geom;";

print STDERR "Querying Overpass for named trail ways in $BBOX[0],$BBOX[1] to $BBOX[2],$BBOX[3]...\n";
my $res = $ua->post('https://overpass-api.de/api/interpreter', Content => "data=$query");
die "Overpass request failed: " . $res->status_line unless $res->is_success;

mkdir '.cache' unless -d '.cache';
open(my $out, '>', '.cache/osm-raw-ways.json') or die "Can't write .cache/osm-raw-ways.json: $!";
print $out $res->decoded_content;
close $out;

my $data = JSON::PP->new->decode($res->decoded_content);
printf STDERR "Cached %d ways to .cache/osm-raw-ways.json\n", scalar(@{$data->{elements}});
