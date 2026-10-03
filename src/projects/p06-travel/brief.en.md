## Client: Faraway Travel (custom trips)

> **Head of Custom Trips**: We get hundreds of "can you plan a trip for me" requests a day, and a consultant needs half an hour to put one itinerary together by hand. Last month we tried letting an LLM write them directly. Customers only found out on the trip: the museum is closed on Mondays, the hotel doesn't take dogs, a 7 pm dinner was booked at a place that only does morning dim sum, the train home left at 7 am while lunch was still on the schedule... The worst one: a ¥5000 trip that actually cost over ¥9000.

> **Tech Lead**: Everything the model writes *looks* plausible; the problem is nobody checks it. Our catalog already exists (transport, hotels, restaurants and attractions are all searchable). What you need to build is a planning agent that gets it **right**: every id really exists, and every constraint holds up to the arithmetic.

### Requirements

1. The input is a message from the customer (origin, destinations, dates, party size, budget, all kinds of preferences); the output is a structured day-by-day itinerary (`TravelPlan`).
2. Only use transport, hotels, restaurants and attractions that **really exist** in the catalog (referenced by id); never make one up.
3. Every customer requirement is a hard constraint: budget, no flights, bringing a pet, wheelchair access, a specific room type, cuisines they want, a maximum number of attractions per day.
4. It must also make common sense: don't visit an attraction on its closing day, only eat at a restaurant while it's open, only start activities after arriving, leave time to get to the station before departing, respect a hotel's minimum stay, and don't repeat a restaurant or an attraction.
5. When the request **can't be met** (say the budget doesn't even cover the round trip), tell the customer honestly: return `feasible: false` with the reason. **Don't force out an itinerary that breaks the rules.**

### Itinerary conventions (the grader checks these rules)

- **Days and cities**: N consecutive days starting on the departure date; `days[i].city` is the city where that day is spent. Multi-city trips follow the order and number of days the customer gave; the last day lists the last destination, and the trip home goes on that day as well.
- **Transport**: day 1 goes from the origin to the first destination, the day you switch cities goes from the previous stop to the next one, and the last day returns to the origin. Only that day's departures can be used, and multiple legs must connect. On days without long-distance travel, `transport` is empty.
- **Time window**: the free time in the city that day = after the arrival time and until **1 hour before** the departure time (08:00-21:00 on days without long-distance travel).
- **Meals**: lunch at 12:00, dinner at 18:30 (breakfast at 08:00 optional), 1 hour each. **Every** lunch and dinner that falls within the free time must be planned, and the restaurant must be open at that time.
- **Attractions**: total visit time + the meals eaten in the city that day (1 hour each) must fit within the free time; no visits on closing days; a full day without long-distance travel needs at least 1 attraction.
- **Hotels**: every night except the last day must be spent in that day's city; rooms = ⌈people / max guests per room⌉; consecutive nights at the same hotel must be at least its minimum stay.
- **No repeats**: a restaurant or an attraction can only appear once in the whole trip.
- **Cost** (computed from catalog prices; `estimatedCost` is for reference only): fare × people + room rate × rooms × nights + restaurant average × people × meals + ticket × people, and the total must not exceed the budget.

### Acceptance criteria

- Core test set: 8 requests under the mock model. A 75% pass rate earns ★, passing all earns ★★, and staying within the token budget as well earns ★★★.
- Full test set: 24 requests (2-4 days, 1-4 people, one city / two cities, various combinations of preferences, 3 infeasible requests), benchmarked against a real model for pass@1 and pass^k.

### Grading rules

- Feasible requests: the plan must satisfy **all** of the rules above and all of the customer's requirements **at once**. Breaking any one of them fails, and the failure reason lists each violation (which day, which id, what was broken).
- Infeasible requests: must return `feasible: false`, and `reason` must explain why (e.g. "over budget", "no pet-friendly hotel").
- Returning `feasible: false` for a feasible request also fails.
