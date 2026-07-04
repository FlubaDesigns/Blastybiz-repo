window.PLATFORM_CATS = {
  fbmarket: {
    maxCats: 1,
    name: 'FB Marketplace',
    icon: '🛒',
    cats: [
      'Antiques & Collectibles','Arts & Crafts','Baby & Kids','Books, Movies & Music',
      'Clothing & Accessories','Electronics','Food & Grocery','Free Stuff','Furniture',
      'Garden & Outdoor','Health & Beauty','Home Goods','Instruments','Miscellaneous',
      'Pet Supplies','Sports & Outdoors','Tools','Toys & Games','Vehicles','Services'
    ]
  },

  craigslist: {
    maxCats: 1,
    name: 'Craigslist',
    icon: '📌',
    cats: [
      'Automotive Services','Beauty Services','Cell Phone / Computer Repair',
      'Creative Services','Cycle / Scooter / Moped Repair','Event & Wedding Services',
      'Farm & Garden Services','Financial Services','Food & Catering','Health & Wellness',
      'Household Help','Handyman','Labor / Moving','Landscaping','Legal Services',
      'Lessons & Tutoring','Pet Services','Real Estate Services','Skilled Trades',
      'Small Business Ads','Travel & Vacation','Writing / Editing / Translation',
      'For Sale — General','For Sale — Antiques','For Sale — Appliances',
      'For Sale — Arts & Crafts','For Sale — Baby','For Sale — Bikes','For Sale — Boats',
      'For Sale — Books','For Sale — Cars & Trucks','For Sale — Clothes',
      'For Sale — Electronics','For Sale — Farm & Garden','For Sale — Free',
      'For Sale — Furniture','For Sale — Jewelry','For Sale — Materials',
      'For Sale — Musical Instruments','For Sale — Photo & Video','For Sale — Sporting',
      'For Sale — Tools','For Sale — Toys',
      'Gigs — Creative','Gigs — Crew','Gigs — Domestic','Gigs — Event',
      'Gigs — Labor','Gigs — Talent'
    ]
  },

  yelp: {
    maxCats: 3,
    name: 'Yelp',
    icon: '⭐',
    cats: [
      // Food & Restaurants
      'American (New)','American (Traditional)','Bakeries','Barbecue','Breakfast & Brunch',
      'Buffets','Burgers','Cafes','Catering','Chinese','Coffee & Tea','Comfort Food',
      'Creperies','Cuban','Delis','Desserts','Dim Sum','Diners','Ethiopian','Fast Food',
      'Filipino','Fish & Chips','Food Delivery Services','Food Stands','Food Trucks',
      'French','Gastropubs','Greek','Hawaiian','Hot Dogs','Ice Cream & Frozen Yogurt',
      'Indian','Italian','Japanese','Juice Bars & Smoothies','Korean','Latin American',
      'Mediterranean','Mexican','Middle Eastern','Noodles','Pizza','Poke','Ramen',
      'Salad','Sandwiches','Seafood','Soul Food','Soup','Sushi Bars','Tacos',
      'Tapas Bars','Thai','Vegetarian','Vietnamese','Waffles','Wings',
      // Home Services
      'Appliance Repair','Carpet Cleaning','Contractors','Electricians','Flooring',
      'Garage Door Services','General Contractors','Handyman','Home Cleaning',
      'Home Inspectors','Home Organization','HVAC','Interior Design','Irrigation',
      'Landscaping','Lawn Services','Locksmiths','Movers','Painters','Pest Control',
      'Plumbers','Pool & Hot Tub Service','Pressure Washers','Roofing','Security Systems',
      'Septic Services','Solar Installation','Tree Services','Water Heater Installation',
      'Window Washing','Windows Installation',
      // Beauty & Spas
      'Barbers','Beauty & Spas','Cosmetics & Beauty Supply','Day Spas','Eyelash Service',
      'Hair Extensions','Hair Removal','Hair Salons','Lash Services','Makeup Artists',
      'Massage','Nail Salons','Piercing','Skin Care','Tanning','Tattoo','Threading',
      'Waxing',
      // Health & Medical
      'Acupuncture','Allergists','Cardiologists','Chiropractors','Counseling & Mental Health',
      'Dentists','Dermatologists','Diagnostic Imaging','Doctors','Ear Nose & Throat',
      'Emergency Rooms','Eye Care','Fertility','Foot Care','General Dentistry',
      'Hospitals','Laser Eye Surgery','Massage Therapy','Naturopathic & Holistic',
      'Nutritionists','Obstetricians & Gynecologists','Occupational Therapy',
      'Oncologists','Optometrists','Oral Surgeons','Orthodontists','Orthopedists',
      'Pain Management','Pediatric Dentists','Pediatricians','Physical Therapy',
      'Podiatrists','Psychiatrists','Psychologists','Rehabilitation Center',
      'Surgeons','Urgent Care','Urologists',
      // Automotive
      'Auto Detailing','Auto Parts & Supplies','Auto Repair','Body Shops','Car Dealers',
      'Car Wash','Gas Stations','Oil Change Stations','Parking','Towing','Windshield Repair',
      // Shopping
      'Antiques','Arts & Crafts','Books, Mags, Music & Video','Children\'s Clothing',
      'Clothing','Computers','Department Stores','Electronics','Eyewear & Opticians',
      'Flowers & Gifts','Furniture Stores','Hardware Stores','Home & Garden',
      'Jewelry','Men\'s Clothing','Music & DVDs','Office Equipment','Pawn Shops',
      'Pet Stores','Pharmacies','Shoe Stores','Shopping Centers','Sporting Goods',
      'Thrift Stores','Toy Stores','Women\'s Clothing',
      // Nightlife & Entertainment
      'Arcades','Arts & Entertainment','Bars','Bowling','Casinos','Cinemas',
      'Comedy Clubs','Country Dance Halls','Dance Clubs','Jazz & Blues','Karaoke',
      'Lounges','Music Venues','Nightlife','Pool Halls','Sports Bars','Wine Bars',
      // Fitness & Recreation
      'Beaches','Cycling Classes','Fitness & Instruction','Golf','Gyms','Hiking',
      'Kickboxing','Martial Arts','Pilates','Rock Climbing','Skating Rinks',
      'Soccer','Sports Clubs','Swimming Pools','Tennis','Weight Loss Centers',
      'Yoga',
      // Education & Professional Services
      'Accountants','Advertising','Career Counseling','Child Care & Day Care',
      'Colleges & Universities','Education','Event Planning & Services',
      'Financial Advising','Insurance','IT Services','Language Schools','Law School',
      'Lawyers','Life Coach','Marketing','Notaries','Photography',
      'Printing Services','Public Services & Government','Real Estate','Real Estate Agents',
      'Real Estate Services','Tax Services','Tutoring Centers','Video Production',
      // Pets
      'Dog Groomers','Dog Parks','Dog Walkers','Pet Boarding','Pet Services',
      'Pet Sitting','Pet Stores','Pet Training','Veterinarians',
      // Hotels & Travel
      'Airports','Bed & Breakfast','Car Rental','Hotels','Hostels','Resorts',
      'Tour Agencies','Vacation Rental Agents'
    ]
  },

  thumbtack: {
    maxCats: 5,
    name: 'Thumbtack',
    icon: '📍',
    cats: [
      // Home — Cleaning
      'House Cleaning','Deep Cleaning','Move In/Out Cleaning','Airbnb Cleaning',
      'Commercial Cleaning','Window Cleaning','Pressure Washing','Gutter Cleaning',
      'Carpet Cleaning','Upholstery Cleaning','Tile & Grout Cleaning',
      'Dryer Vent Cleaning','Chimney Cleaning','Air Duct Cleaning',
      // Home — Repair & Maintenance
      'Handyman','Appliance Repair','Plumbing','Electrical','HVAC','Heating Repair',
      'AC Repair','Furnace Repair','Roof Repair','Roofing','Gutter Repair',
      'Gutter Installation','Drywall Repair','Door Repair','Window Repair',
      'Window Installation','Garage Door Repair','Garage Door Installation',
      'Foundation Repair','Crawl Space Repair','Deck Repair','Fence Repair',
      'Fence Installation','Lock Installation','Locksmith','Tile Installation',
      'Flooring Installation','Hardwood Flooring','Carpet Installation',
      'Countertop Installation','Cabinet Installation','Kitchen Remodeling',
      'Bathroom Remodeling','Basement Remodeling','General Contracting',
      // Home — Outdoor
      'Landscaping','Lawn Care','Lawn Mowing','Yard Cleanup','Tree Service',
      'Tree Trimming','Stump Removal','Hedge Trimming','Sprinkler Repair',
      'Sprinkler Installation','Sod Installation','Mulching','Leaf Removal',
      'Snow Removal','Driveway Sealing','Pressure Washing',
      // Home — Other
      'Painting — Interior','Painting — Exterior','Wallpaper Installation',
      'Home Inspection','Pest Control','Pool Service','Pool Cleaning',
      'Pool Repair','Septic Service','Water Heater Installation',
      'Generator Installation','Solar Panel Installation','Smart Home Installation',
      'Home Security Installation','TV Mounting','Furniture Assembly',
      'Moving','Packing & Unpacking','Junk Removal','Storage',
      'Demolition','Hauling',
      // Personal Services
      'Personal Training','Yoga Instructor','Pilates Instructor',
      'Massage Therapist','Acupuncture','Life Coach','Nutrition Counseling',
      'Personal Chef','Meal Prep','Dog Training','Dog Walking','Pet Sitting',
      'Pet Grooming','Tutoring','Math Tutoring','Reading Tutoring',
      'SAT / ACT Prep','Music Lessons','Guitar Lessons','Piano Lessons',
      'Singing Lessons','Art Lessons','Language Lessons',
      // Events
      'Event Planning','Wedding Planning','Wedding Photography',
      'Wedding Videography','Wedding Catering','Wedding DJ',
      'Event Photography','Event Videography','Event Catering',
      'DJ','Photo Booth Rental','Balloon Decorating','Floral Design',
      'Cake Decorator','Bartending','Catering','Party Planning',
      'Kids Party Entertainment','Bounce House Rental','Tent Rental',
      'Stage Rental','AV Equipment Rental','Magician','Face Painting',
      'Clown','Limo Service',
      // Professional Services
      'Accounting','Bookkeeping','Tax Preparation','Legal Services',
      'Business Consulting','Marketing','Social Media Management',
      'Website Design','Graphic Design','Photography','Videography',
      'Notary','Computer Repair','IT Support','Data Recovery',
      'Virtual Assistant','Resume Writing','Career Coaching',
      'Real Estate Photography','Interior Design','Home Staging',
      // Wellness & Beauty
      'Hair Salon','Makeup Artist','Nail Technician','Esthetician',
      'Eyebrow Threading','Waxing','Spray Tanning','Tattoo Artist',
      'Massage','Skincare','Laser Hair Removal','Microblading',
      'Float Tank','Sofa Cleaning','Upholstery Cleaning',
      // Specialty & Misc
      'Baby Shower Planning','Balloon Twisting','Graffiti Removal',
      'Holiday Lighting Installation','Hot Tub Repair','Hot Tub Installation',
      'Kitchen Cabinet Painting','Knife Sharpening','Mattress Disposal',
      'Online Tutoring','Powder Coating','Propane Delivery',
      'Puzzle Assembly','Radon Testing','Shutter Installation',
      'Skydiving','Storage Unit Delivery','Swimming Lessons',
      'Vehicle Wrap','Weed Control','Wine Cellar Storage'
    ]
  },

  angi: {
    maxCats: 5,
    name: 'Angi',
    icon: '🔧',
    cats: [
      // Cleaning
      'Air Duct Cleaning','Carpet Cleaning','Carpet Installation','Chimney Sweep',
      'Dryer Vent Cleaning','Gutter Cleaning','House Cleaning','Mold Removal',
      'Pressure Washing','Window Cleaning',
      // Construction & Remodeling
      'Basement Finishing','Bathroom Remodel','Cabinet Installation',
      'Concrete Work','Countertop Installation','Custom Closets','Deck Building',
      'Deck Repair','Door Installation','Door Repair','Drywall Repair',
      'Egress Window Installation','Epoxy Flooring','Fence Installation',
      'Fence Repair','Flooring','Foundation Repair','Garage Conversion',
      'Garage Door Repair','General Contractor','Hardwood Flooring',
      'Kitchen Remodel','Room Addition','Shed Building','Skylight Installation',
      'Siding','Sunroom Construction','Tile Installation','Tub-to-Shower Conversion',
      'Wallpaper Installation','Wallpaper Removal','Window Installation',
      // Electrical
      'Ceiling Fan Installation','Electrical','Electrical Panel Upgrade',
      'Exhaust Fan Installation','Generator Installation','Holiday Light Installation',
      'Lamp Post Installation','Lighting Installation','Smart Home Installation',
      // HVAC & Energy
      'HVAC','AC Installation','AC Repair','Boiler Repair','Duct Sealing',
      'Furnace Installation','Furnace Repair','Heat Pump Installation',
      'Insulation','Pipe Insulation','Solar Panel Installation',
      'Tankless Water Heater','Water Heater','Weatherization',
      // Landscaping & Outdoor
      'Driveway Cleaning','Driveway Paving','Driveway Repair',
      'Fire Pit Construction','French Drain Installation','Hardscape Design',
      'Irrigation','Landscaping','Landscape Design','Lawn Care',
      'Leaf Removal','Masonry','Mulching','Outdoor Kitchen',
      'Outdoor Lighting','Pergola Construction','Pool Construction',
      'Pool Demolition','Pool Service','Retaining Wall','Snow Removal',
      'Stump Grinding','Tree Service','Tree Planting',
      // Painting
      'Interior Painting','Painting — Exterior',
      // Plumbing & Water
      'Drainage','Plumbing','Rain Gutter Cleaning','Septic Service',
      'Waterproofing','Well Pump Service',
      // Repair & Maintenance
      'Appliance Repair','Asbestos Removal','Attic Insulation',
      'Awning Installation','Bathtub Refinishing','Biohazard Cleanup',
      'Brick Repair','Ceiling Repair','Crawl Space Repair',
      'Fire Damage Restoration','Fireplace Installation','Flood Damage Restoration',
      'Gutter Installation','Gutter Repair','Handyman','Home Inspection',
      'Hot Tub Installation','House Leveling','Kitchen Cabinet Installation',
      'Kitchen Exhaust Cleaning','Microwave Installation','Mudroom Design',
      'Painting','Pest Control','Roof Repair','Roofing','Satellite Dish Installation',
      'Sauna Installation','Slate Roofing','Storm Door Installation',
      'Termite Treatment','Tile Repair','Water Damage Restoration',
      'Window Repair','Wood Rot Repair',
      // Additional specialty services
      'Balcony Repair','Barn Door Installation','Bathroom Tile Repair',
      'Central Vacuum Installation','Chimney Repair','Concrete Resurfacing',
      'Disabled Access Ramp','Dryer Repair','Gutter Guard Installation',
      'Handicap Ramp','Home Theater Installation','Hot Tub Repair',
      'Landscaping Lighting','Leak Detection','Marble Polishing',
      'Outdoor Fireplace','Patio Cover Installation','Pool Fence Installation',
      'Roof Cleaning','Screen Door Repair','Security Camera Installation',
      'Sprinkler System Repair','Stone Veneer Installation','Stucco Repair',
      'Tree Stump Removal','Under-Cabinet Lighting','Vinyl Siding Repair'
    ]
  },

  alignable: {
    maxCats: 1,
    name: 'Alignable',
    icon: '🤝',
    cats: [
      'Accounting & Finance','Agriculture','Architecture','Auto & Vehicle',
      'Automotive Dealership','Beauty & Wellness','Business Consulting',
      'Childcare','Childcare & Education','Cleaning Services',
      'Construction & Contracting','Construction Management','Creative & Design',
      'Cybersecurity','Data Analytics','Dental','Digital Marketing',
      'E-commerce','Entertainment','Event Planning','Event Venue',
      'Export / Import','Financial Planning','Fitness & Health',
      'Food & Restaurant','Franchise','Freight & Logistics','Government & Nonprofit',
      'Graphic Design','Health Coaching','Home Improvement','Home Inspection',
      'Hospitality','HR & Recruiting','Insurance','Interior Design',
      'Investment Services','IT & Technology','Janitorial','Landscaping',
      'Law & Legal','Manufacturing','Marketing Agency','Medical & Healthcare',
      'Mortgage','Music Production','Non-Profit','Notary','Nutritionist',
      'Pet Services','Photography & Video','Photography Studio','Podcast',
      'Printing & Signs','Property Management','Public Relations','Real Estate',
      'Recruiting','Retail','Roofing Contractor','Security Services',
      'Senior Services','Social Media','Staffing','Sustainability',
      'Telecom','Transportation','Travel','Veterinary','Web Design',
      'Wedding & Events','Youth Sports'
    ]
  },

  applemaps: {
    maxCats: 5,
    name: 'Apple Maps',
    icon: '🗺️',
    cats: [
      // Food & Drink
      'Bagel Shop','Bakery','Bar','Brewery','Bubble Tea','Cafe','Coffee Shop',
      'Cupcake Shop','Diner','Fast Food','Food','Food Bank','Food Truck',
      'Ice Cream Shop','Juice Bar','Meal Delivery','Meal Takeaway',
      'Night Club','Pastry Shop','Restaurant','Sports Bar','Sushi Restaurant',
      'Tea House','Winery',
      // Retail & Shopping
      'Auto Parts Store','Beauty Supply Store','Bookstore','Bridal Shop',
      'Cell Phone Store','Clothing Store','Comic Book Store','Convenience Store',
      'Department Store','Electronics Store','Florist','Furniture Store',
      'Game Store','Garden Center','Gift Shop','Gun Shop','Hardware Store',
      'Hat Store','Health Food Store','Jewelry Store','Laundry',
      'Lingerie Store','Liquor Store','Nail Salon','Paint Store',
      'Party Supply Store','Pawn Shop','Perfume Store','Pet Store',
      'Pharmacy','Printing Service','Resale Shop','Running Store',
      'Shoe Store','Shopping Mall','Smoke Shop','Sporting Goods Store',
      'Store','Surf Shop','Thrift Store','Tire Shop','Tool Rental',
      'Toy Store','Used Book Store','Vape Shop','Vitamin Store',
      // Automotive
      'Car Dealer','Car Rental','Car Repair','Car Wash','Gas Station',
      'Auto Body Shop','Impound Lot','Oil Change','Tow Truck',
      // Health & Medical
      'Audiologist','Chiropractor','Dentist','Doctor','Emergency Room',
      'Eye Doctor','Fertility Clinic','Hospital','Nursing Home',
      'Orthodontist','Pediatrician','Pharmacist','Physical Therapist',
      'Physiotherapist','Podiatrist','Psychiatrist','Psychologist',
      'Rehabilitation Center','Senior Center','Sleep Clinic','Urgent Care',
      'Veterinary Care',
      // Personal Services
      'Beauty Salon','Barber Shop','Day Spa','Dog Groomer',
      'Driving School','Hair Care','Laundromat','Locksmith',
      'Notary Public','Pet Adoption','Piercing Shop','Shoe Repair',
      'Spa','Tailor','Tattoo Studio',
      // Professional Services
      'Accounting','Data Recovery','Financial Advisor','Immigration Attorney',
      'Insurance Agency','IT Services','Law Firm','Limo Service',
      'Marketing Agency','Notary','Photography Studio','Private Investigator',
      'Printing Service','Real Estate Agency','Resume Service',
      'Travel Agency','Web Design',
      // Education & Recreation
      'Art Gallery','Art Studio','Beauty School','Bowling Alley',
      'Campground','Childcare','Community Center','Cooking School',
      'Co-Working Space','Dance School','Escape Room','Gym',
      'Indoor Playground','Karaoke','Laser Tag','Library',
      'Martial Arts','Meditation Center','Miniature Golf',
      'Movie Theater','Museum','Music School','Pilates Studio',
      'Playground','Pool Hall','Pottery Studio','Public Pool',
      'Rec Center','Rock Climbing','Roller Rink','Skate Park',
      'Ski Resort','Soccer Field','Stadium','Trampoline Park',
      'University','Water Park','Wedding Venue','Yoga Studio','Zoo',
      // Travel & Lodging
      'Airport','Amusement Park','Aquarium','Bed and Breakfast',
      'Campground','Casino','Hotel','Hostel','Lodge','Motel',
      'RV Park','Resort',
      // Other Place Types
      'ATM','Bank','Bus Station','Cemetery','Church','City Hall',
      'Consulate','Courthouse','Credit Union','Embassy',
      'Fire Station','Fuel Station','Government Office',
      'Homeless Shelter','Hospital','Library','Military Base',
      'Parking','Police','Post Office','Public Services',
      'Social Services','Soup Kitchen','Subway Station',
      'Synagogue','Taxi Stand','Train Station','University'
    ]
  }
};
