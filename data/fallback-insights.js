// Fallback content used only if the live AI call fails.
const FALLBACK_INSIGHTS = {
  'dipsea': {
    history: "Built in 1904 and added to the National Register of Historic Places in 2010, the Dipsea Trail is best known as the route of the Dipsea Race, first run in 1905 and still held annually — the oldest trail race in the United States.",
    recentNotes: "Expect redwood groves, open meadow, and coastal views across the full route. Parking at Stinson fills early on weekends; many hikers start from Mill Valley instead.",
    communitySentiment: "Hikers describe it as tough but rewarding, with the elevation change and stairs cited most often as the hard part — especially on the return leg."
  },
  'tennessee-valley': {
    history: "Part of the Golden Gate National Recreation Area, Tennessee Valley takes its name from the SS Tennessee, a steamship wrecked nearby in 1853.",
    recentNotes: "A parking fee applies at the trailhead. The route is flat and wide for most of its length, making it accessible for a broad range of hikers.",
    communitySentiment: "Frequently described as beginner- and tourist-friendly, with some noting it gets crowded near the start on weekends."
  },
  'cataract-falls': {
    history: "The trail follows Cataract Creek through the Mount Tamalpais watershed. A wartime relic — the engine from a 1945 midair collision between two Navy Corsair aircraft — is still visible in the creek near the Ray Murphy Trail Bridge.",
    recentNotes: "Best visited shortly after rainfall, when the falls are fullest. Trail can be muddy in wet months, and there is no cell signal along the route.",
    communitySentiment: "Consistently praised for its views and relative quiet, with occasional notes about fallen trees or slippery sections after storms."
  },
  'steep-ravine': {
    history: "Steep Ravine is the only trail in Marin County built with a permanent ladder, roughly 15 feet tall, as part of its short but demanding descent through redwood canyon.",
    recentNotes: "Most often hiked as part of the Dipsea–Steep Ravine–Matt Davis loop from Pantoll, which charges a parking fee.",
    communitySentiment: "Hikers call it short but intense, and usually recommend pairing it with neighboring trails rather than hiking it alone."
  },
  'matt-davis': {
    history: "Named for a Mill Valley trailbuilder, Matt Davis Trail is one of the primary connectors between Stinson Beach and the Pantoll area of Mount Tamalpais State Park.",
    recentNotes: "Most commonly hiked as part of the classic Dipsea–Steep Ravine–Matt Davis loop, which totals roughly 7 miles and 1,900 feet of elevation gain.",
    communitySentiment: "Regularly called out for its golden hillside views and coastal panoramas, and is a favorite among locals doing the full loop."
  },
  'phoenix-lake': {
    history: "Phoenix Lake was formed in 1905 by an earth-fill dam, making it the second-oldest reservoir in Marin County. It's owned and managed by the Marin Municipal Water District, and the loop passes a historic log cabin built around 1894.",
    recentNotes: "Starts at Natalie Coffin Greene Park. Parking fills by mid-morning on weekends. The loop is mostly flat with some optional steeper side trails up to Bald Hill for wider views.",
    communitySentiment: "Regularly described as an easy, dog- and kid-friendly local favorite — popular enough that early arrival matters more than the terrain does."
  },
  'old-railroad-grade': {
    history: "This trail follows the route of the Mount Tamalpais & Muir Woods Railway, nicknamed \"the Crookedest Railroad in the World,\" which carried passengers from Mill Valley to the East Peak summit through 281 curves from 1896 until it closed in 1930.",
    recentNotes: "The grade is gradual and steady rather than steep, which makes it popular with both hikers and mountain bikers heading to East Peak. The West Point Inn along the way offers snacks and a rest stop.",
    communitySentiment: "Often recommended as the easier way up Mt. Tam compared to routes like Steep Ravine, with the historic rail grade making the climb feel manageable despite the distance."
  },
  'muir-woods-main': {
    history: "Muir Woods National Monument was established in 1908, protecting one of the last old-growth coast redwood stands in the Bay Area. The Main Trail's boardwalk loop passes through Cathedral Grove.",
    recentNotes: "Reservations are required for parking or shuttle access. The boardwalk is flat and accessible, making it the most crowded but least strenuous trail in the park.",
    communitySentiment: "Consistently praised for the scale and quiet of the redwoods, with most feedback noting how quickly crowds thin out on the trail's quieter side loops."
  },
  'yolanda-hidden-meadow': {
    history: "The Deer Park trailhead area was long used for grazing and small-scale ranching before becoming part of Marin County's open space network; Yolanda Trail itself is named for a local family associated with the land.",
    recentNotes: "Starts from the Deer Park Fire Road trailhead in Fairfax. Mostly exposed through open meadow sections, so it can run hot on summer afternoons — shade is concentrated in the oak woodland stretches.",
    communitySentiment: "Regularly recommended as an easy-to-moderate loop for trail running and dog walking, with runners noting the meadow sections make for a nice change of pace from Marin's more forested trails."
  },
  'bon-tempe-loop': {
    history: "Bon Tempe Lake was completed in 1949 as part of the Marin Municipal Water District's reservoir system on Mount Tamalpais, and sits just downhill from the older Lake Lagunitas.",
    recentNotes: "Access is via Sky Oaks Road, which has a per-car entrance fee collected by MMWD. The loop is largely shaded by second-growth forest and stays close to the shoreline for most of its length.",
    communitySentiment: "A popular pick among local trail runners for its relatively flat, shaded loop — often combined with the adjacent Lake Lagunitas loop for a longer run."
  },
  'bald-hill': {
    history: "Bald Hill's open, grassy summit (elevation 1,180 ft) sits above Ross and is preserved as open space partly due to a long local campaign against 1970s-era development plans for the hillside.",
    recentNotes: "Climbs steadily from Phoenix Lake with little shade, so it's more exposed to sun and wind than most nearby trails — worth an earlier start in summer.",
    communitySentiment: "Frequently cited as one of the better view-to-effort payoffs near Ross, with hikers calling out the 360-degree summit views over the bay and Mt Tamalpais."
  }
};

const GENERIC_FALLBACK_INSIGHTS = {
  history: "This is a route you added yourself, so there's no third-party history to pull — but it's part of your map now.",
  recentNotes: "Since this route isn't in public trail databases, conditions and access details aren't available here yet — go by your own knowledge of the area.",
  communitySentiment: "No outside reviews exist for a personal route like this one — it's yours."
};
