/**
 * Combined, deduplicated category list built from all platform category lists.
 * Used by suggestCategory CF to give AI real options to match against.
 * Mirrors public/platform-categories.js — keep in sync when platforms are updated.
 */
'use strict';

const _raw = [
  // ── Google Business Profile ──────────────────────────────────────────────
  'Restaurant','Pizza restaurant','Italian restaurant','Mexican restaurant',
  'Chinese restaurant','American restaurant','Fast food restaurant','Cafe',
  'Coffee shop','Bakery','Bar','Night club','Grocery store',
  'Supermarket','Convenience store','Clothing store','Shoe store',
  'Department store','Electronics store','Furniture store','Home goods store',
  'Hardware store','Pet store','Florist','Jewelry store','Book store',
  'Toy store','Gift shop','Sporting goods store','Bicycle store',
  'Auto parts store','Car dealer','Car repair','Car wash',
  'Gas station','Tire shop','Towing service',
  'Hair salon','Barber shop','Beauty salon','Nail salon','Spa',
  'Massage therapist','Tattoo shop',
  'Doctor','Dentist','Optometrist','Chiropractor','Physical therapist',
  'Pharmacy','Hospital','Urgent care center','Veterinarian',
  'Gym','Fitness center','Yoga studio','Martial arts school',
  'Plumber','Electrician','Roofing contractor','HVAC contractor',
  'Painter','Flooring contractor','Landscaper','Lawn care service',
  'House cleaning service','Moving company','Storage facility',
  'Accountant','Lawyer','Insurance agency','Real estate agency',
  'Bank','Financial planner','Tax preparation service',
  'Hotel','Motel','Bed and breakfast','Hostel','Resort',
  'Movie theater','Amusement park','Museum','Art gallery',
  'Library','Park','Zoo','Aquarium','Event venue','Wedding venue',
  'Photography studio','Printing shop','Shipping company',
  'Elementary school','Middle school','High school','University',
  'Tutoring service','Driving school','Music school',
  'Church','Mosque','Temple','Synagogue',
  'Locksmith','Pest control','Security system supplier',

  // ── Yelp ────────────────────────────────────────────────────────────────
  'American (New)','American (Traditional)','Barbecue','Breakfast & Brunch',
  'Buffets','Burgers','Catering','Comfort Food','Cuban','Delis','Desserts',
  'Dim Sum','Diners','Ethiopian','Filipino','Fish & Chips','Food Truck',
  'French','Gastropubs','Greek','Hawaiian','Hot Dogs','Ice Cream & Frozen Yogurt',
  'Indian','Japanese','Juice Bars & Smoothies','Korean','Latin American',
  'Mediterranean','Middle Eastern','Noodles','Poke','Ramen',
  'Salad','Sandwiches','Seafood','Soul Food','Soup','Sushi Bars','Tacos',
  'Tapas Bars','Thai','Vegetarian','Vietnamese','Waffles','Wings',
  'Appliance Repair','Carpet Cleaning','General Contractor','Handyman',
  'Home Cleaning','Home Inspector','Home Organization','Interior Design',
  'Irrigation','Pest Control','Pool & Hot Tub Service','Pressure Washing',
  'Septic Services','Solar Installation','Tree Services',
  'Water Heater Installation','Window Washing',
  'Day Spa','Eyelash Service','Hair Extensions','Hair Removal',
  'Lash Services','Makeup Artist','Massage','Piercing','Skin Care',
  'Tanning','Threading','Waxing',
  'Acupuncture','Chiropractor','Counseling & Mental Health',
  'Diagnostic Imaging','Emergency Room','Eye Care','Fertility',
  'Naturopathic & Holistic','Nutritionist','Occupational Therapy',
  'Orthodontist','Pain Management','Podiatrist','Psychiatrist','Psychologist',
  'Rehabilitation Center','Surgeon','Urologist',
  'Auto Detailing','Body Shop','Oil Change Station','Windshield Repair',
  'Antiques','Arts & Crafts','Thrift Store','Pawn Shop',
  'Arcade','Bowling','Casino','Comedy Club','Dance Club','Jazz & Blues',
  'Karaoke','Lounge','Music Venue','Pool Hall','Sports Bar','Wine Bar',
  'Cycling Class','Rock Climbing','Skating Rink','Swimming Pool','Tennis',
  'Weight Loss Center',
  'Advertising','Career Counseling','Child Care & Day Care',
  'Event Planning & Services','Financial Advising','IT Services',
  'Language School','Life Coach','Marketing','Notary','Video Production',
  'Dog Groomer','Dog Walker','Pet Boarding','Pet Sitting','Pet Training',
  'Bed & Breakfast','Car Rental','Tour Agency','Vacation Rental Agent',

  // ── Thumbtack ────────────────────────────────────────────────────────────
  'Deep Cleaning','Move In/Out Cleaning','Airbnb Cleaning',
  'Commercial Cleaning','Gutter Cleaning','Upholstery Cleaning',
  'Dryer Vent Cleaning','Air Duct Cleaning',
  'HVAC','Heating Repair','AC Repair','Furnace Repair','Roof Repair',
  'Drywall Repair','Door Repair','Window Repair','Garage Door Repair',
  'Foundation Repair','Crawl Space Repair','Deck Repair','Fence Repair',
  'Tile Installation','Flooring Installation','Hardwood Flooring',
  'Carpet Installation','Cabinet Installation','Kitchen Remodeling',
  'Bathroom Remodeling','Basement Remodeling',
  'Lawn Mowing','Yard Cleanup','Tree Trimming','Stump Removal',
  'Hedge Trimming','Sprinkler Repair','Sod Installation','Mulching',
  'Leaf Removal','Snow Removal','Driveway Sealing',
  'Painting — Interior','Painting — Exterior','Wallpaper Installation',
  'Home Security Installation','TV Mounting','Furniture Assembly',
  'Junk Removal','Demolition','Hauling',
  'Personal Training','Yoga Instructor','Pilates Instructor',
  'Personal Chef','Meal Prep','Dog Training','Dog Walking',
  'Math Tutoring','SAT / ACT Prep','Guitar Lessons','Piano Lessons',
  'Singing Lessons','Art Lessons','Language Lessons',
  'Wedding Photography','Wedding Videography','Wedding Catering','Wedding DJ',
  'Photo Booth Rental','Balloon Decorating','Floral Design',
  'Cake Decorator','Bartending','Party Planning','Kids Party Entertainment',
  'Bounce House Rental','Magician','Face Painting','Limo Service',
  'Bookkeeping','Tax Preparation','Business Consulting',
  'Social Media Management','Website Design','Graphic Design',
  'Computer Repair','IT Support','Data Recovery','Virtual Assistant',
  'Resume Writing','Career Coaching','Home Staging',
  'Nail Technician','Esthetician','Eyebrow Threading','Spray Tanning',
  'Tattoo Artist','Microblading','Float Tank',
  'Hot Tub Repair','Pool Cleaning','Pool Repair','Vehicle Wrap',
  'Swimming Lessons',

  // ── Angi ─────────────────────────────────────────────────────────────────
  'Basement Finishing','Bathroom Remodel','Concrete Work',
  'Countertop Installation','Custom Closets','Deck Building',
  'Egress Window Installation','Epoxy Flooring','Fence Installation',
  'Garage Conversion','Room Addition','Shed Building',
  'Skylight Installation','Siding','Sunroom Construction',
  'Tub-to-Shower Conversion','Electrical Panel Upgrade',
  'Exhaust Fan Installation','Generator Installation',
  'AC Installation','Boiler Repair','Duct Sealing','Furnace Installation',
  'Heat Pump Installation','Insulation','Tankless Water Heater',
  'Driveway Paving','Driveway Repair','Fire Pit Construction',
  'French Drain Installation','Hardscape Design','Landscape Design',
  'Outdoor Kitchen','Outdoor Lighting','Pergola Construction',
  'Pool Construction','Retaining Wall','Tree Planting',
  'Drainage','Waterproofing','Asbestos Removal',
  'Biohazard Cleanup','Fire Damage Restoration','Flood Damage Restoration',
  'Water Damage Restoration',

  // ── Alignable ────────────────────────────────────────────────────────────
  'Accounting & Finance','Agriculture','Architecture',
  'Automotive Dealership','Childcare & Education',
  'Construction Management','Creative & Design','Cybersecurity',
  'Data Analytics','Digital Marketing','E-commerce',
  'Entertainment','Export / Import','Financial Planning',
  'Fitness & Health','Franchise','Freight & Logistics',
  'Government & Nonprofit','Health Coaching','Home Inspection',
  'Hospitality','HR & Recruiting','Investment Services',
  'Janitorial','Manufacturing','Marketing Agency','Medical & Healthcare',
  'Mortgage','Music Production','Non-Profit','Podcast',
  'Printing & Signs','Property Management','Public Relations',
  'Recruiting','Retail','Security Services','Senior Services',
  'Social Media','Staffing','Sustainability','Telecom',
  'Transportation','Travel','Web Design','Wedding & Events','Youth Sports',

  // ── Apple Maps ───────────────────────────────────────────────────────────
  'Bagel Shop','Bubble Tea','Cupcake Shop','Diner','Food Bank',
  'Ice Cream Shop','Juice Bar','Meal Delivery','Pastry Shop',
  'Tea House','Winery','Brewery',
  'Auto Body Shop','Oil Change',
  'Audiologist','Fertility Clinic','Nursing Home','Sleep Clinic',
  'Beautician','Laundromat','Shoe Repair','Tailor',
  'Immigration Attorney','Private Investigator',
  'Art Studio','Beauty School','Bowling Alley','Co-Working Space',
  'Dance School','Escape Room','Indoor Playground','Laser Tag',
  'Meditation Center','Miniature Golf','Pottery Studio',
  'Roller Rink','Skate Park','Ski Resort','Trampoline Park',
  'Water Park',

  // ── Nextdoor ─────────────────────────────────────────────────────────────
  'Childcare & Education','Construction & Renovation',
  'Events & Entertainment','Landscaping & Lawn Care',
  'Movers & Storage','Professional Services',

  // ── Craigslist ───────────────────────────────────────────────────────────
  'Automotive Services','Beauty Services','Cell Phone / Computer Repair',
  'Creative Services','Event & Wedding Services',
  'Farm & Garden Services','Financial Services',
  'Food & Catering','Health & Wellness','Household Help',
  'Labor / Moving','Legal Services','Lessons & Tutoring',
  'Pet Services','Real Estate Services','Skilled Trades',
  'Small Business Ads','Writing / Editing / Translation',

  // ── FB Marketplace ───────────────────────────────────────────────────────
  'Arts & Crafts','Baby & Kids','Books, Movies & Music',
  'Clothing & Accessories','Electronics','Food & Grocery','Free Stuff',
  'Garden & Outdoor','Health & Beauty','Home Goods','Instruments',
  'Pet Supplies','Sports & Outdoors','Tools','Toys & Games','Vehicles',
];

// Deduplicate (case-insensitive) and sort
const _seen = new Set();
const ALL_CATEGORIES = _raw.filter(c => {
  const k = c.toLowerCase();
  if (_seen.has(k)) return false;
  _seen.add(k);
  return true;
}).sort();

module.exports = { ALL_CATEGORIES };
